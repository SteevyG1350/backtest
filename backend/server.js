const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws'); // Import WebSocket library
const { v4: uuidv4 } = require('uuid'); // Import uuid for unique IDs

// Add fs for logging
const fsPromises = require('fs/promises');
const logFilePath = path.join(__dirname, 'backend_debug.log');

async function logToFile(message) {
  try {
    await fsPromises.appendFile(logFilePath, `${new Date().toISOString()} - ${message}\n`);
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

const app = express();
const port = 3001;

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

app.post('/run-backtest', async (req, res) => {
  await logToFile('Received backtest request');
  await logToFile(`Request headers: ${JSON.stringify(req.headers)}`);
  await logToFile(`Request body: ${JSON.stringify(req.body)}`);

  try {
    // Use upload.single as a promise-based middleware
    await new Promise((resolve, reject) => {
      upload.single('data')(req, res, (err) => {
        if (err) {
          logToFile(`Multer error: ${err.message}`);
          return reject(err);
        }
        resolve();
      });
    });

    await logToFile(`File received: ${req.file ? JSON.stringify(req.file) : 'No file'}`);
    await logToFile(`Body after multer: ${JSON.stringify(req.body)}`);

    const dataFile = req.file;
    if (!dataFile) {
      await logToFile('No data file uploaded.');
      return res.status(400).send('No data file uploaded.');
    }

    let config;
    try {
      config = JSON.parse(req.body.config);
      await logToFile(`Parsed config: ${JSON.stringify(config)}`);
    } catch (e) {
      await logToFile(`Error parsing config JSON: ${e.message}`);
      return res.status(400).send(`Error parsing config: ${e.message}`);
    }

    const pythonScriptPath = path.join(__dirname, '..', 'trading_system', 'backtester.py');
    await logToFile(`Python script path: ${pythonScriptPath}`);

    const pythonProcess = spawn('/home/steve/trading_app/trading_system/venv/bin/python3', [
      pythonScriptPath,
      '--filepath', dataFile.path,
      '--atr_mult_sl', config.atr_mult_sl,
      '--atr_mult_trail', config.atr_mult_trail,
      '--rr_target', config.rr_target,
    ]);

    let stdoutOutput = '';
    let stderrOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutOutput += data.toString();
      logToFile(`Python stdout: ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      console.error(`stderr: ${stderrOutput}`); // Keep console error for immediate visibility
      logToFile(`Python stderr: ${stderrOutput.trim()}`);
    });

    pythonProcess.on('close', async (code) => {
      await logToFile(`child process exited with code ${code}`);
      // Clean up the uploaded file
      try {
        fs.unlinkSync(dataFile.path);
        await logToFile(`Cleaned up uploaded file: ${dataFile.path}`);
      } catch (unlinkErr) {
        await logToFile(`Error cleaning up file ${dataFile.path}: ${unlinkErr.message}`);
      }

      try {
        const results = JSON.parse(stdoutOutput); // Use stdoutOutput here
        await logToFile(`Python script results: ${JSON.stringify(results)}`);

        // Save results to a file
        const backtestId = uuidv4();
        const resultsFilePath = path.join(__dirname, 'backtest_results', `${backtestId}.json`);
        await fsPromises.writeFile(resultsFilePath, JSON.stringify(results, null, 2));
        await logToFile(`Backtest results saved to: ${resultsFilePath}`);

        res.json({ ...results, backtestId }); // Send back results and the ID
        // // Stop the app completely after each backtest as requested by the user.
        // // This will kill both the backend and frontend processes.
        // // The user will need to manually restart the servers to run another backtest.
        // setTimeout(() => {
        //   console.log('Shutting down backend server...');
        //   process.kill(process.pid, 'SIGTERM'); // Kill backend process
        // }, 1000); // Give some time for the response to be sent

        // // Also kill the frontend process. This assumes the frontend is running in a separate process.
        // // The PGID for the frontend was 15418 from the last restart.
        // setTimeout(() => {
        //   console.log('Shutting down frontend server...');
        //   process.kill(15418, 'SIGTERM'); // Kill frontend process
        // }, 1500); // Give some time for backend to start shutting down
      } catch (e) {
        await logToFile(`Error parsing JSON from python script: ${e.message}. Python stdout: ${stdoutOutput}. Python stderr: ${stderrOutput}`); // Include stderrOutput in error log
        res.status(500).send(`Error running backtest: ${e.message}. Python stdout: ${stdoutOutput}. Python stderr: ${stderrOutput}`); // Include stderrOutput in response
      }
    });

    pythonProcess.on('error', async (err) => {
      await logToFile(`Failed to start python process: ${err.message}`);
      res.status(500).send(`Failed to start backtest process: ${err.message}`);
    });

  } catch (error) {
    await logToFile(`Unhandled error in /run-backtest: ${error.message}`);
    res.status(500).send(`Server error: ${error.message}`);
  }
});

app.get('/list-backtests', async (req, res) => {
  const resultsDir = path.join(__dirname, 'backtest_results');
  try {
    const files = await fsPromises.readdir(resultsDir);
    const backtestSummaries = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(resultsDir, file);
        const content = await fsPromises.readFile(filePath, 'utf8');
        const results = JSON.parse(content);
        backtestSummaries.push({
          backtestId: file.replace('.json', ''),
          final_equity: results.final_equity,
          total_trades: results.total_trades,
          wins: results.wins,
          losses: results.losses,
          win_rate: results.win_rate,
          avg_pnl: results.avg_pnl,
          // Add other summary fields as needed
        });
      }
    }
    res.json(backtestSummaries);
  } catch (error) {
    await logToFile(`Error listing backtest results: ${error.message}`);
    res.status(500).send('Error listing backtest results.');
  }
});

app.get('/download-backtest/:id', async (req, res) => {
  const { id } = req.params;
  const filePath = path.join(__dirname, 'backtest_results', `${id}.json`);

  try {
    if (fs.existsSync(filePath)) {
      res.download(filePath, `${id}.json`);
    } else {
      res.status(404).send('Backtest results not found.');
    }
  } catch (error) {
    await logToFile(`Error downloading backtest results for ID ${id}: ${error.message}`);
    res.status(500).send('Error downloading backtest results.');
  }
});

app.get('/stream-data', async (req, res) => {
  const { filename, atr_mult_sl, atr_mult_trail, rr_target } = req.query;
  if (!filename) {
    return res.status(400).send('Filename is required for streaming.');
  }

  const filePath = path.join(__dirname, '..', 'trading_system', 'data', filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found.');
  }

  const pythonScriptPath = path.join(__dirname, '..', 'trading_system', 'backtester.py');
  
  // Spawn the Python process in streaming mode
  const pythonProcess = spawn('/home/steve/trading_app/trading_system/venv/bin/python3', [
    pythonScriptPath,
    '--filepath', filePath,
    '--atr_mult_sl', atr_mult_sl || '1.094', // Use default if not provided
    '--atr_mult_trail', atr_mult_trail || '4.093', // Use default if not provided
    '--rr_target', rr_target || '3.990', // Use default if not provided
    '--stream' // Enable streaming mode
  ]);

  let buffer = '';
  pythonProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    let lines = buffer.split('\n');
    buffer = lines.pop(); // Keep the last (possibly incomplete) line in buffer

    lines.forEach(line => {
      if (line.trim() === '') return;
      try {
        const parsedData = JSON.parse(line);
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(parsedData));
          }
        });
      } catch (e) {
        console.error('Error parsing JSON from Python:', e, 'Line:', line);
      }
    });
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data.toString()}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python streaming process exited with code ${code}`);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'stream-finished' }));
      }
    });
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to start Python streaming process:', err);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'stream-error', message: err.message }));
      }
    });
  });

  res.send('Streaming initiated via Python process.');
});


const server = app.listen(port, async () => {
  await logToFile(`Backend server listening at http://localhost:${port}`);
  console.log(`Backend server listening at http://localhost:${port}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  console.log('Client connected');
  ws.on('close', () => console.log('Client disconnected'));
});


import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import { Container, Row, Col, Navbar, Form, Button, Card, Table, Spinner, Alert, Nav, TabContainer, TabContent, TabPane } from 'react-bootstrap';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import 'bootstrap/dist/css/bootstrap.min.css';

// New component for Trades Table
function TradesTable({ trades }) {
  const [currentPage, setCurrentPage] = useState(1);
  const tradesPerPage = 20; // Number of trades per page

  // Calculate the trades to display on the current page
  const indexOfLastTrade = currentPage * tradesPerPage;
  const indexOfFirstTrade = indexOfLastTrade - tradesPerPage;
  const currentTrades = trades.slice(indexOfFirstTrade, indexOfLastTrade);

  // Calculate total pages
  const totalPages = Math.ceil(trades.length / tradesPerPage);

  // Handle page change
  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  return (
    <div>
      <h5 className="mb-3">All Trades ({trades.length})</h5>
      <Table striped bordered hover size="sm" responsive className="mb-3">
        <thead>
          <tr>
            <th>Entry Time</th>
            <th>Exit Time</th>
            <th>Type</th>
            <th>PnL</th>
          </tr>
        </thead>
        <tbody>
          {currentTrades.map((trade, index) => (
            <tr key={index}>
              <td>{trade.entry_time}</td>
              <td>{trade.exit_time}</td>
              <td>{trade.type}</td>
              <td>{trade.pnl.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* Pagination */}
      <Nav className="justify-content-center">
        <Nav.Item>
          <Nav.Link disabled={currentPage === 1} onClick={() => paginate(1)} className="text-primary">
            First
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link disabled={currentPage === 1} onClick={() => paginate(currentPage - 1)} className="text-primary">
            Previous
          </Nav.Link>
        </Nav.Item>
        {[...Array(totalPages).keys()].map((number) => (
          <Nav.Item key={number + 1}>
            <Nav.Link onClick={() => paginate(number + 1)} active={number + 1 === currentPage} className="text-primary">
              {number + 1}
            </Nav.Link>
          </Nav.Item>
        ))}
        <Nav.Item>
          <Nav.Link disabled={currentPage === totalPages} onClick={() => paginate(currentPage + 1)} className="text-primary">
            Next
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link disabled={currentPage === totalPages} onClick={() => paginate(totalPages)} className="text-primary">
            Last
          </Nav.Link>
        </Nav.Item>
      </Nav>
    </div>
  );
}

// New component for Performance Charts
function PerformanceCharts({ results }) {
  return (
    <div>
      <h5 className="mb-3">Performance Metrics</h5>
      <Table striped bordered hover size="sm" className="mb-4">
        <tbody>
          <tr>
            <td>Final Equity</td>
            <td>${results.final_equity.toFixed(2)}</td>
          </tr>
          <tr>
            <td>Total Trades</td>
            <td>{results.total_trades}</td>
          </tr>
          <tr>
            <td>Wins</td>
            <td>{results.wins}</td>
          </tr>
          <tr>
            <td>Losses</td>
            <td>{results.losses}</td>
          </tr>
          <tr>
            <td>Win Rate</td>
            <td>{results.win_rate.toFixed(2)}%</td>
          </tr>
          <tr>
            <td>Average PnL</td>
            <td>${results.avg_pnl.toFixed(2)}</td>
          </tr>
        </tbody>
      </Table>

      <h5 className="mb-3">Equity Curve</h5>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={results.equity_curve.map((value, index) => ({name: index, equity: value}))}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="equity" stroke="#007bff" activeDot={{ r: 8 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}


function App() {
  const [file, setFile] = useState(null);
  const [params, setParams] = useState({
    atr_mult_sl: 1.094,
    atr_mult_trail: 4.093,
    rr_target: 3.990,
  });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('backtest'); // State for active tab

  // Backtest history states
  const [backtestHistory, setBacktestHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  const fetchBacktestHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await axios.get('http://localhost:3001/list-backtests');
      setBacktestHistory(response.data);
    } catch (err) {
      console.error('Error fetching backtest history:', err);
      setHistoryError('Failed to load backtest history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Fetch history when component mounts or when history tab is active
  useEffect(() => {
    if (activeTab === 'history') {
      fetchBacktestHistory();
    }
  }, [activeTab, fetchBacktestHistory]);

  // Real-time streaming states
  const [ws, setWs] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedData, setStreamedData] = useState([]);
  const [streamedTrades, setStreamedTrades] = useState([]);
  const [streamFilename, setStreamFilename] = useState('XAUUSD1.csv'); // Default filename

  // WebSocket connection and message handling
  useEffect(() => {
    if (isStreaming) {
      const newWs = new WebSocket(`ws://localhost:3001`); // Connect to backend WebSocket
      setWs(newWs);

      newWs.onopen = () => {
        console.log('WebSocket connected');
        // Start streaming data from backend
        axios.get(`http://localhost:3001/stream-data?filename=${streamFilename}`)
          .then(response => console.log(response.data))
          .catch(err => console.error('Error starting stream:', err));
      };

      newWs.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.type === 'stream-finished') {
          console.log('Stream finished');
          setIsStreaming(false);
          newWs.close();
        } else if (data.type === 'price_update') {
          setStreamedData(prevData => [...prevData, data]);
          console.log('Received price update:', data);
          if (data.trade_event) {
            setStreamedTrades(prevTrades => [...prevTrades, {
              time: data.trade_event.entry_time || data.trade_event.exit_time,
              type: data.trade_event.direction,
              price: data.trade_event.entry_price || data.trade_event.exit_price,
              pnl: data.trade_event.pnl !== undefined ? data.trade_event.pnl.toFixed(2) : 'N/A'
            }]);
          }
        } else if (data.type === 'stream-error') {
          console.error('Stream error:', data.message);
          setIsStreaming(false);
          newWs.close();
        }
      };

      newWs.onclose = () => {
        console.log('WebSocket disconnected');
        setIsStreaming(false);
      };

      newWs.onerror = (err) => {
        console.error('WebSocket error:', err);
        setIsStreaming(false);
      };

      return () => {
        if (newWs.readyState === WebSocket.OPEN) {
          newWs.close();
        }
      };
    }
  }, [isStreaming, streamFilename]); // Re-run effect when isStreaming or streamFilename changes

  const handleStartStream = () => {
    setStreamedData([]); // Clear previous data
    setStreamedTrades([]); // Clear previous trades
    setIsStreaming(true);
  };

  const handleStopStream = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    setIsStreaming(false);
  };

  const onDrop = useCallback(acceptedFiles => {
    setFile(acceptedFiles[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const handleParamChange = (e) => {
    setParams({ ...params, [e.target.name]: e.target.value });
  };

  const handleRunBacktest = async () => {
    if (!file) {
      alert('Please upload a data file.');
      return;
    }

    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('data', file);
    formData.append('config', JSON.stringify(params));

    try {
      const response = await axios.post('http://localhost:3001/run-backtest', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setResults(response.data);
      alert('Backtest results received! Check console for details.'); // Temporary alert for debugging
      console.log('Backtest results:', response.data); // Log to browser console
      setActiveTab('performance'); // Switch to performance tab after successful backtest
      fetchBacktestHistory(); // Refresh backtest history
      // Clarification for "stop the app when backtest is completed":
      // The backtest process (Python script) completes on the backend.
      // The frontend then receives the results and updates the UI accordingly.
      // The application (frontend and backend servers) remains running for further interaction.
    } catch (error) {
      console.error('Error running backtest:', error);
      setError('An error occurred while running the backtest.');
    } finally {
      setLoading(false);
    }
  };

  const handleClearFile = () => {
    setFile(null);
  };

  const dropzoneStyle = {
    border: `2px dashed ${isDragActive ? '#007bff' : (file ? '#28a745' : '#ccc')}`,
    padding: '20px',
    textAlign: 'center',
    cursor: 'pointer',
    borderRadius: '5px',
    backgroundColor: isDragActive ? '#e9f5ff' : '#f8f9fa',
    transition: 'all 0.3s ease-in-out',
  };

  return (
    <>
      <Navbar bg="dark" variant="dark" expand="lg" fixed="top">
        <Container>
          <Navbar.Brand href="#home">Trading Strategy Backtester</Navbar.Brand>
          <Navbar.Toggle aria-controls="basic-navbar-nav" />
          <Navbar.Collapse id="basic-navbar-nav">
            <Nav className="me-auto">
              <Nav.Link onClick={() => setActiveTab('backtest')} active={activeTab === 'backtest'}>Backtest</Nav.Link>
              <Nav.Link onClick={() => setActiveTab('performance')} active={activeTab === 'performance'} disabled={!results}>Performance</Nav.Link>
              <Nav.Link onClick={() => setActiveTab('trades')} active={activeTab === 'trades'} disabled={!results}>Trades</Nav.Link>
              <Nav.Link onClick={() => setActiveTab('realtime')} active={activeTab === 'realtime'}>Real-time Stream</Nav.Link>
              <Nav.Link onClick={() => setActiveTab('history')} active={activeTab === 'history'}>Backtest History</Nav.Link>
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <Container style={{ marginTop: '80px' }}> {/* Adjusted margin-top for fixed navbar */}
        <TabContainer activeKey={activeTab} onSelect={(k) => setActiveTab(k)}>
          <TabContent>
            <TabPane eventKey="backtest">
              <Row className="justify-content-center">
                <Col md={6}>
                  <Card className="mb-4 shadow-sm">
                    <Card.Header className="bg-primary text-white">Configuration</Card.Header>
                    <Card.Body>
                      <h5 className="mb-3">1. Upload Data</h5>
                      <div {...getRootProps()} style={dropzoneStyle}>
                        <input {...getInputProps()} />
                        {isDragActive ? <p className="text-primary">Drop the files here ...</p> : <p>Drag 'n' drop your data file here, or click to select</p>}
                        {file && (
                          <div className="mt-2">
                            <p className="mb-1">Selected file: <span className="fw-bold">{file.name}</span></p>
                            <Button variant="outline-danger" size="sm" onClick={handleClearFile}>Clear File</Button>
                          </div>
                        )}
                      </div>

                      <h5 className="mt-4 mb-3">2. Parameters</h5>
                      <Form>
                        <Form.Group className="mb-3">
                          <Form.Label>ATR SL Multiplier</Form.Label>
                          <Form.Control type="number" name="atr_mult_sl" value={params.atr_mult_sl} onChange={handleParamChange} step="0.001" />
                        </Form.Group>
                        <Form.Group className="mb-3">
                          <Form.Label>ATR Trail Multiplier</Form.Label>
                          <Form.Control type="number" name="atr_mult_trail" value={params.atr_mult_trail} onChange={handleParamChange} step="0.001" />
                        </Form.Group>
                        <Form.Group className="mb-3">
                          <Form.Label>Risk/Reward Target</Form.Label>
                          <Form.Control type="number" name="rr_target" value={params.rr_target} onChange={handleParamChange} step="0.001" />
                        </Form.Group>
                      </Form>

                      <Button variant="success" onClick={handleRunBacktest} disabled={loading} className="w-100 mt-4">
                        {loading ? (
                          <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                        ) : (
                          ''
                        )}
                        {loading ? 'Running Backtest...' : 'Run Backtest'}
                      </Button>
                    </Card.Body>
                  </Card>
                </Col>

                <Col md={6}>
                  <Card className="mb-4 shadow-sm">
                    <Card.Header className="bg-info text-white">Backtest Summary</Card.Header>
                    <Card.Body>
                      {loading && <div className="text-center py-5"><Spinner animation="border" role="status" className="mb-3" /><p>Loading results...</p></div>}
                      {error && <Alert variant="danger" className="text-center">{error}</Alert>}
                      {results ? (
                        <PerformanceCharts results={results} />
                      ) : (
                        !loading && <p className="text-center text-muted py-5">Run a backtest to see the results.</p>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            </TabPane>

            <TabPane eventKey="performance">
              <Card className="mb-4 shadow-sm">
                <Card.Header className="bg-info text-white">Performance Visualization</Card.Header>
                <Card.Body>
                  {results ? (
                    <PerformanceCharts results={results} />
                  ) : (
                    <Alert variant="info" className="text-center py-5">Run a backtest first to view performance.</Alert>
                  )}
                </Card.Body>
              </Card>
            </TabPane>

            <TabPane eventKey="trades">
              <Card className="mb-4 shadow-sm">
                <Card.Header className="bg-info text-white">Detailed Trades</Card.Header>
                <Card.Body>
                  {results ? (
                    <TradesTable trades={results.trades} />
                  ) : (
                    <Alert variant="info" className="text-center py-5">Run a backtest first to view trades.</Alert>
                  )}
                </Card.Body>
              </Card>
            </TabPane>

            <TabPane eventKey="realtime">
              <Card className="mb-4 shadow-sm">
                <Card.Header className="bg-primary text-white">Real-time Data Stream</Card.Header>
                <Card.Body>
                  <Form.Group className="mb-3">
                    <Form.Label>Data File (from trading_system/data/)</Form.Label>
                    <Form.Control
                      type="text"
                      value={streamFilename}
                      onChange={(e) => setStreamFilename(e.target.value)}
                      placeholder="e.g., XAUUSD1.csv"
                    />
                  </Form.Group>
                  <div className="d-grid gap-2 mb-4">
                    <Button variant="success" onClick={handleStartStream} disabled={isStreaming}>
                      {isStreaming ? 'Streaming...' : 'Start Real-time Stream'}
                    </Button>
                    <Button variant="danger" onClick={handleStopStream} disabled={!isStreaming}>
                      Stop Stream
                    </Button>
                  </div>

                  {isStreaming && (
                    <Alert variant="info" className="text-center">
                      Streaming data from {streamFilename}...
                    </Alert>
                  )}

                  {streamedData.length > 0 && (
                    <>
                      <h5 className="mb-3">Real-time Price Chart</h5>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={streamedData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="timestamp" />
                          <YAxis domain={['dataMin', 'dataMax']} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="close" stroke="#8884d8" dot={false} />
                        </LineChart>
                      </ResponsiveContainer>

                      <h5 className="mt-4 mb-3">Real-time Trades</h5>
                      <Table striped bordered hover size="sm" responsive>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Type</th>
                            <th>Price</th>
                            <th>PnL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {streamedTrades.length > 0 ? (
                            streamedTrades.map((trade, index) => (
                              <tr key={index}>
                                <td>{trade.time}</td>
                                <td>{trade.type}</td>
                                <td>{trade.price}</td>
                                <td>{trade.pnl}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan="4" className="text-center text-muted">No trades yet.</td>
                            </tr>
                          )}
                        </tbody>
                      </Table>
                    </>
                  )}
                </Card.Body>
              </Card>
            </TabPane>

            <TabPane eventKey="history">
              <Card className="mb-4 shadow-sm">
                <Card.Header className="bg-primary text-white">Backtest History</Card.Header>
                <Card.Body>
                  {historyLoading && <div className="text-center py-5"><Spinner animation="border" role="status" className="mb-3" /><p>Loading history...</p></div>}
                  {historyError && <Alert variant="danger" className="text-center">{historyError}</Alert>}
                  {!historyLoading && !historyError && backtestHistory.length === 0 && (
                    <Alert variant="info" className="text-center py-5">No backtest history found. Run a backtest to see results here.</Alert>
                  )}
                  {!historyLoading && !historyError && backtestHistory.length > 0 && (
                    <Table striped bordered hover responsive>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Final Equity</th>
                          <th>Total Trades</th>
                          <th>Win Rate</th>
                          <th>Avg PnL</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backtestHistory.map((bt) => (
                          <tr key={bt.backtestId}>
                            <td>{bt.backtestId.substring(0, 8)}...</td>
                            <td>${bt.final_equity.toFixed(2)}</td>
                            <td>{bt.total_trades}</td>
                            <td>{bt.win_rate.toFixed(2)}%</td>
                            <td>${bt.avg_pnl.toFixed(2)}</td>
                            <td>
                              <Button
                                variant="info"
                                size="sm"
                                onClick={() => window.open(`http://localhost:3001/download-backtest/${bt.backtestId}`, '_blank')}
                              >
                                Download
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>
            </TabPane>
          </TabContent>
        </TabContainer>
      </Container>
    </>
  );
}

export default App;

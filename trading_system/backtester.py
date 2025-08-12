import pandas as pd
import pandas_ta as ta
import os
import numpy as np
import json
import argparse

def run_backtest(df, initial_capital, risk_pct, atr_mult_sl, atr_mult_trail, rr_target, unit_value, partial_exit, partial_exit_pct):
    trades = []
    equity = initial_capital
    equity_curve = [initial_capital]
    position = None
    highest_since_entry = 0
    lowest_since_entry = 0

    for i in range(1, len(df)):
        row = df.iloc[i]
        
        if position is None:
            if row['long_signal']:
                sl_dist = row['ATR_14'] * atr_mult_sl
                if sl_dist == 0: continue
                tp_dist = sl_dist * rr_target
                stop_loss = row['close'] - sl_dist
                take_profit = row['close'] + tp_dist
                
                max_risk_amount = equity * risk_pct
                qty = np.floor(max_risk_amount / (sl_dist * unit_value))

                if qty > 0:
                    position = {'type': 'long', 'entry_price': row['close'], 'stop_loss': stop_loss, 'take_profit': take_profit, 'quantity': qty, 'entry_time': row.name.strftime('%Y-%m-%d %H:%M:%S')}
                    highest_since_entry = row['high']
            
            elif row['short_signal']:
                sl_dist = row['ATR_14'] * atr_mult_sl
                if sl_dist == 0: continue
                tp_dist = sl_dist * rr_target
                stop_loss = row['close'] + sl_dist
                take_profit = row['close'] - tp_dist

                max_risk_amount = equity * risk_pct
                qty = np.floor(max_risk_amount / (sl_dist * unit_value))

                if qty > 0:
                    position = {'type': 'short', 'entry_price': row['close'], 'stop_loss': stop_loss, 'take_profit': take_profit, 'quantity': qty, 'entry_time': row.name.strftime('%Y-%m-%d %H:%M:%S')}
                    lowest_since_entry = row['low']

        elif position is not None:
            if position['type'] == 'long':
                if partial_exit and not position.get('partial_exited', False):
                    partial_tp_price = position['entry_price'] + (position['take_profit'] - position['entry_price']) * 0.5
                    if row['high'] >= partial_tp_price:
                        partial_qty = position['quantity'] * partial_exit_pct
                        pnl = (partial_tp_price - position['entry_price']) * partial_qty * unit_value
                        equity += pnl
                        trades.append({'entry_time': position['entry_time'], 'exit_time': row.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'long_partial'})
                        position['quantity'] -= partial_qty
                        position['partial_exited'] = True

                highest_since_entry = max(highest_since_entry, row['high'])
                trail_stop_price = highest_since_entry - row['ATR_14'] * atr_mult_trail
                position['stop_loss'] = max(position['stop_loss'], trail_stop_price)

                if row['low'] <= position['stop_loss']:
                    pnl = (position['stop_loss'] - position['entry_price']) * position['quantity'] * unit_value
                    equity += pnl
                    trades.append({'entry_time': position['entry_time'], 'exit_time': row.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'long'})
                    position = None
                elif row['high'] >= position['take_profit']:
                    pnl = (position['take_profit'] - position['entry_price']) * position['quantity'] * unit_value
                    equity += pnl
                    trades.append({'entry_time': position['entry_time'], 'exit_time': row.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'long'})
                    position = None
            
            elif position['type'] == 'short':
                if partial_exit and not position.get('partial_exited', False):
                    partial_tp_price = position['entry_price'] - (position['entry_price'] - position['take_profit']) * 0.5
                    if row['low'] <= partial_tp_price:
                        partial_qty = position['quantity'] * partial_exit_pct
                        pnl = (position['entry_price'] - partial_tp_price) * partial_qty * unit_value
                        equity += pnl
                        trades.append({'entry_time': position['entry_time'], 'exit_time': row.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'short_partial'})
                        position['quantity'] -= partial_qty
                        position['partial_exited'] = True

                lowest_since_entry = min(lowest_since_entry, row['low'])
                trail_stop_price = lowest_since_entry + row['ATR_14'] * atr_mult_trail
                position['stop_loss'] = min(position['stop_loss'], trail_stop_price)

                if row['high'] >= position['stop_loss']:
                    pnl = (position['entry_price'] - position['stop_loss']) * position['quantity'] * unit_value
                    equity += pnl
                    trades.append({'entry_time': position['entry_time'], 'exit_time': row.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'short'})
                    position = None
                elif row['low'] <= position['take_profit']:
                    pnl = (position['entry_price'] - position['take_profit']) * position['quantity'] * unit_value
                    equity += pnl
                    trades.append({'entry_time': position['entry_time'], 'exit_time': row.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'short'})
                    position = None
        
        equity_curve.append(equity)

    results = {
        "final_equity": equity,
        "total_trades": len(trades),
        "wins": len([t for t in trades if t['pnl'] > 0]),
        "losses": len([t for t in trades if t['pnl'] <= 0]),
        "win_rate": (len([t for t in trades if t['pnl'] > 0]) / len(trades) * 100) if len(trades) > 0 else 0,
        "avg_pnl": np.mean([t['pnl'] for t in trades]) if len(trades) > 0 else 0,
        "trades": trades,
        "equity_curve": equity_curve
    }
    return results

def define_strategy(df_slice):
    # Calculate technical indicators
    df_slice.ta.atr(length=14, append=True, col_names='ATR_14')
    df_slice.ta.rsi(length=14, append=True, col_names='RSI_14')
    df_slice.ta.sma(length=20, append=True, col_names='SMA_20')
    df_slice.ta.sma(length=50, append=True, col_names='SMA_50')

    # Regime Detection (requires enough data for 60m resampling)
    if len(df_slice) >= 60: # Ensure enough data for 60-minute resampling
        ohlc_dict = {'open':'first', 'high':'max', 'low':'min', 'close':'last', 'volume':'sum'}
        df_60m = df_slice.resample('60min').apply(ohlc_dict).dropna()
        if not df_60m.empty:
            df_60m['sma50'] = ta.sma(df_60m['close'], length=50)
            df_60m['sma50_prev'] = df_60m['sma50'].shift(1)
            bbands = ta.bbands(df_60m['close'], length=20, std=2)
            df_60m['bb_width'] = bbands['BBB_20_2.0']
            df_60m['bb_width_sma50'] = ta.sma(df_60m['bb_width'], length=50)
            def get_regime(row):
                if row['sma50'] > row['sma50_prev']: return "TREND_UP"
                elif row['sma50'] < row['sma50_prev']: return "TREND_DOWN"
                else: return "RANGE_HIGH_VOL" if row['bb_width'] > row['bb_width_sma50'] else "RANGE_LOW_VOL"
            df_60m['regime'] = df_60m.apply(get_regime, axis=1)
            df_slice['regime'] = df_60m['regime'].reindex(df_slice.index, method='ffill')
        else:
            df_slice['regime'] = "UNKNOWN" # Default if 60m data is not enough
    else:
        df_slice['regime'] = "UNKNOWN" # Default if 60m data is not enough


    # Signal Generation
    df_slice.ta.cdl_pattern(name=["engulfing", "hammer"], append=True)
    long_candle_signal = (df_slice['CDL_ENGULFING'] > 0) | (df_slice['CDL_HAMMER'] > 0)
    short_candle_signal = (df_slice['CDL_ENGULFING'] < 0)
    ma_slope_up = df_slice['SMA_20'] > df_slice['SMA_50']
    ma_slope_down = df_slice['SMA_20'] < df_slice['SMA_50']
    df_slice['long_signal'] = long_candle_signal & (df_slice['regime'] != "TREND_DOWN") & ma_slope_up
    df_slice['short_signal'] = short_candle_signal & (df_slice['regime'] != "TREND_UP") & ma_slope_down
    
    return df_slice

def stream_backtest(df, initial_capital, risk_pct, atr_mult_sl, atr_mult_trail, rr_target, unit_value, partial_exit, partial_exit_pct):
    trades = []
    equity = initial_capital
    position = None
    highest_since_entry = 0
    lowest_since_entry = 0

    # Keep a rolling window of data for indicator calculation
    # The size of this window should be at least the largest lookback period for any indicator
    # For example, if SMA_50 is the largest, then window_size should be at least 50
    window_size = 60 # For 60-minute regime detection, ensure enough data

    for i in range(len(df)):
        current_bar = df.iloc[i]
        
        # Create a slice of data up to the current bar for indicator calculation
        # Ensure enough data for indicators
        if i < window_size - 1:
            # Not enough data for full indicator calculation yet, just send price
            output_data = {
                "type": "price_update",
                "timestamp": current_bar.name.strftime('%Y-%m-%d %H:%M:%S'),
                "open": current_bar['open'],
                "high": current_bar['high'],
                "low": current_bar['low'],
                "close": current_bar['close'],
                "volume": current_bar['volume'],
                "equity": equity
            }
            print(json.dumps(output_data))
            continue

        df_slice = df.iloc[max(0, i - window_size + 1):i+1].copy()
        df_slice = define_strategy(df_slice)
        current_bar_with_signals = df_slice.iloc[-1]

        trade_event = None

        if position is None:
            if current_bar_with_signals['long_signal']:
                sl_dist = current_bar_with_signals['ATR_14'] * atr_mult_sl
                if sl_dist == 0: continue
                tp_dist = sl_dist * rr_target
                stop_loss = current_bar_with_signals['close'] - sl_dist
                take_profit = current_bar_with_signals['close'] + tp_dist
                
                max_risk_amount = equity * risk_pct
                qty = np.floor(max_risk_amount / (sl_dist * unit_value))

                if qty > 0:
                    position = {'type': 'long', 'entry_price': current_bar_with_signals['close'], 'stop_loss': stop_loss, 'take_profit': take_profit, 'quantity': qty, 'entry_time': current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S')}
                    highest_since_entry = current_bar_with_signals['high']
                    trade_event = {
                        "type": "trade_entry",
                        "direction": "long",
                        "entry_time": position['entry_time'],
                        "entry_price": position['entry_price'],
                        "quantity": position['quantity']
                    }
            
            elif current_bar_with_signals['short_signal']:
                sl_dist = current_bar_with_signals['ATR_14'] * atr_mult_sl
                if sl_dist == 0: continue
                tp_dist = sl_dist * rr_target
                stop_loss = current_bar_with_signals['close'] + sl_dist
                take_profit = current_bar_with_signals['close'] - tp_dist

                max_risk_amount = equity * risk_pct
                qty = np.floor(max_risk_amount / (sl_dist * unit_value))

                if qty > 0:
                    position = {'type': 'short', 'entry_price': current_bar_with_signals['close'], 'stop_loss': stop_loss, 'take_profit': take_profit, 'quantity': qty, 'entry_time': current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S')}
                    lowest_since_entry = current_bar_with_signals['low']
                    trade_event = {
                        "type": "trade_entry",
                        "direction": "short",
                        "entry_time": position['entry_time'],
                        "entry_price": position['entry_price'],
                        "quantity": position['quantity']
                    }

        elif position is not None:
            if position['type'] == 'long':
                if partial_exit and not position.get('partial_exited', False):
                    partial_tp_price = position['entry_price'] + (position['take_profit'] - position['entry_price']) * 0.5
                    if current_bar_with_signals['high'] >= partial_tp_price:
                        partial_qty = position['quantity'] * partial_exit_pct
                        pnl = (partial_tp_price - position['entry_price']) * partial_qty * unit_value
                        equity += pnl
                        trades.append({'entry_time': position['entry_time'], 'exit_time': current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'long_partial'})
                        position['quantity'] -= partial_qty
                        position['partial_exited'] = True
                        trade_event = {
                            "type": "trade_exit",
                            "direction": "long_partial",
                            "exit_time": current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'),
                            "exit_price": partial_tp_price,
                            "pnl": pnl
                        }

                highest_since_entry = max(highest_since_entry, current_bar_with_signals['high'])
                trail_stop_price = highest_since_entry - current_bar_with_signals['ATR_14'] * atr_mult_trail
                position['stop_loss'] = max(position['stop_loss'], trail_stop_price)

                if current_bar_with_signals['low'] <= position['stop_loss']:
                    pnl = (position['stop_loss'] - position['entry_price']) * position['quantity'] * unit_value
                    equity += pnl
                    trades.append({'entry_time': position['entry_time'], 'exit_time': current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'long'})
                    trade_event = {
                        "type": "trade_exit",
                        "direction": "long",
                        "exit_time": current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'),
                        "exit_price": position['stop_loss'],
                        "pnl": pnl
                    }
                    position = None
                elif current_bar_with_signals['high'] >= position['take_profit']:
                    pnl = (position['take_profit'] - position['entry_price']) * position['quantity'] * unit_value
                    equity += pnl
                    trades.append({'entry_time': position['entry_time'], 'exit_time': current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'long'})
                    trade_event = {
                        "type": "trade_exit",
                        "direction": "long",
                        "exit_time": current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'),
                        "exit_price": position['take_profit'],
                        "pnl": pnl
                    }
                    position = None
            
            elif position['type'] == 'short':
                if partial_exit and not position.get('partial_exited', False):
                    partial_tp_price = position['entry_price'] - (position['entry_price'] - position['take_profit']) * 0.5
                    if current_bar_with_signals['low'] <= partial_tp_price:
                        partial_qty = position['quantity'] * partial_exit_pct
                        pnl = (position['entry_price'] - partial_tp_price) * partial_qty * unit_value
                        equity += pnl
                        trades.append({'entry_time': position['entry_time'], 'exit_time': current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'short_partial'})
                        position['quantity'] -= partial_qty
                        position['partial_exited'] = True
                        trade_event = {
                            "type": "trade_exit",
                            "direction": "short_partial",
                            "exit_time": current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'),
                            "exit_price": partial_tp_price,
                            "pnl": pnl
                        }

                lowest_since_entry = min(lowest_since_entry, current_bar_with_signals['low'])
                trail_stop_price = lowest_since_entry + current_bar_with_signals['ATR_14'] * atr_mult_trail
                position['stop_loss'] = min(position['stop_loss'], trail_stop_price)

                if current_bar_with_signals['high'] >= position['stop_loss']:
                    pnl = (position['entry_price'] - position['stop_loss']) * position['quantity'] * unit_value
                    equity += pnl
                    trades.append({'entry_time': position['entry_time'], 'exit_time': current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'short'})
                    trade_event = {
                        "type": "trade_exit",
                        "direction": "short",
                        "exit_time": current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'),
                        "exit_price": position['stop_loss'],
                        "pnl": pnl
                    }
                    position = None
                elif current_bar_with_signals['low'] <= position['take_profit']:
                    pnl = (position['entry_price'] - position['take_profit']) * position['quantity'] * unit_value
                    equity += pnl
                    trades.append({'entry_time': position['entry_time'], 'exit_time': current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'), 'pnl': pnl, 'type': 'short'})
                    trade_event = {
                        "type": "trade_exit",
                        "direction": "short",
                        "exit_time": current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'),
                        "exit_price": position['take_profit'],
                        "pnl": pnl
                    }
                    position = None
        
        output_data = {
            "type": "price_update",
            "timestamp": current_bar_with_signals.name.strftime('%Y-%m-%d %H:%M:%S'),
            "open": current_bar_with_signals['open'],
            "high": current_bar_with_signals['high'],
            "low": current_bar_with_signals['low'],
            "close": current_bar_with_signals['close'],
            "volume": current_bar_with_signals['volume'],
            "equity": equity
        }
        if trade_event:
            output_data["trade_event"] = trade_event
        
        print(json.dumps(output_data))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--filepath', required=True)
    parser.add_argument('--atr_mult_sl', type=float, required=True)
    parser.add_argument('--atr_mult_trail', type=float, required=True)
    parser.add_argument('--rr_target', type=float, required=True)
    parser.add_argument('--atr_mult_tp', type=float, default=None, help='ATR multiplier for take profit. Overrides rr_target.')
    parser.add_argument('--stream', action='store_true', help='Enable streaming mode for real-time visualization.')
    args = parser.parse_args()

    # --- Parameters ---
    initial_capital = 1000
    risk_pct = 0.005
    unit_value = 1.0
    partial_exit = True
    partial_exit_pct = 0.5
    max_drawdown_pct = 0.2

    df = pd.read_csv(
        args.filepath,
        header=None,
        sep=r'\s+',
        names=['date', 'time', 'open', 'high', 'low', 'close', 'volume']
    )
    df['datetime'] = pd.to_datetime(df['date'] + ' ' + df['time'])
    df.set_index('datetime', inplace=True)
    df.drop(['date', 'time'], axis=1, inplace=True)

    if args.stream:
        stream_backtest(df, initial_capital, risk_pct, args.atr_mult_sl, args.atr_mult_trail, args.rr_target, unit_value, partial_exit, partial_exit_pct, max_drawdown_pct, args.atr_mult_tp)
    else:
        # Apply strategy to the entire DataFrame for batch backtesting
        df_strategy = define_strategy(df.copy())
        results = run_backtest(df_strategy, initial_capital, risk_pct, args.atr_mult_sl, args.atr_mult_trail, args.rr_target, unit_value, partial_exit, partial_exit_pct, max_drawdown_pct, args.atr_mult_tp)
        print(json.dumps(results, indent=4))
import time
import logging
from pathlib import Path
import load_results

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s: %(message)s')

# Files
PARAM_FILE = Path('parameters.json')
ATHLETES_CSV = Path('Athletenliste.csv')

def get_total_athletes():
    """Get total number of athletes from Athletenliste.csv"""
    if not ATHLETES_CSV.exists():
        return 0
    try:
        with ATHLETES_CSV.open('r', encoding='utf-8') as f:
            lines = f.readlines()
            # Subtract 1 for header
            return max(0, len(lines) - 1)
    except Exception as e:
        logging.error(f"Could not read {ATHLETES_CSV}: {e}")
        return 0

def load_batch_config():
    """Load batch size and interval from parameters.json"""
    batch_size = 10  # Default
    interval_minutes = 5  # Default
    if PARAM_FILE.exists():
        try:
            import json
            with PARAM_FILE.open('r', encoding='utf-8') as f:
                cfg = json.load(f)
            batch_size = cfg.get('batchSize', batch_size)
            interval_minutes = cfg.get('intervalMinutes', interval_minutes)
        except Exception as e:
            logging.warning(f"Could not read batch config from {PARAM_FILE}: {e}")
    return batch_size, interval_minutes

def run_auto_batch_loading():
    """Run automatic batch loading of results"""
    total_athletes = get_total_athletes()
    if total_athletes == 0:
        logging.error("No athletes found in Athletenliste.csv")
        return

    batch_size, interval_minutes = load_batch_config()
    logging.info(f"Starting auto batch loading: {total_athletes} athletes, batch size {batch_size}, interval {interval_minutes} minutes")

    start_row = 2  # Start from row 2 (after header)
    batch_num = 1

    while start_row <= total_athletes + 1:  # +1 because start_row is 1-based
        logging.info(f"Processing batch {batch_num}: athletes {start_row-1} to {min(start_row-1 + batch_size, total_athletes)}")

        # Temporarily modify config for this batch
        # Note: This modifies parameters.json temporarily
        try:
            import json
            if PARAM_FILE.exists():
                with PARAM_FILE.open('r', encoding='utf-8') as f:
                    cfg = json.load(f)
            else:
                cfg = {}

            cfg['batchSize'] = batch_size
            cfg['startRow'] = start_row

            with PARAM_FILE.open('w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)

            # Load results for this batch
            load_results.fetch_results_for_config_athletes()

        except Exception as e:
            logging.error(f"Error processing batch {batch_num}: {e}")

        # Check if we've processed all athletes
        if start_row - 1 + batch_size >= total_athletes:
            logging.info("All athletes processed. Stopping auto loading.")
            break

        # Wait before next batch
        logging.info(f"Waiting {interval_minutes} minutes before next batch...")
        time.sleep(interval_minutes * 60)

        # Move to next batch
        start_row += batch_size
        batch_num += 1

    # Reset batch config
    try:
        import json
        if PARAM_FILE.exists():
            with PARAM_FILE.open('r', encoding='utf-8') as f:
                cfg = json.load(f)
            cfg.pop('batchSize', None)
            cfg.pop('startRow', None)
            with PARAM_FILE.open('w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logging.warning(f"Could not reset batch config: {e}")

if __name__ == '__main__':
    run_auto_batch_loading()</content>
<parameter name="filePath">c:\Users\julia\Documents\Python Scripts\FantasyAthletics\auto_batch_load.py
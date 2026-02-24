import os
import sqlite3

import pandas as pd

from src.utils.utils import load_config

# Load configuration
config_path = "src/config/config.yaml"
config = load_config(config_path)

# Get paths from config.yaml
ASC_FILE_DIR = config["FINANCIAL_RAW_FILE_PATH"]  # Directory with ASC files
SQLITE_DB_FILE = config["FINANCIAL_SQLITE_PATH"]  # SQLite database file


def load_asc_files_to_sqlite(db_file, asc_dir):
    """
    Loads all .asc files from a directory into an SQLite database.

    Args:
        db_file (str): Path to the SQLite database file.
        asc_dir (str): Path to the directory containing .asc files.
    """
    try:
        # Ensure the database directory exists
        os.makedirs(os.path.dirname(db_file), exist_ok=True)

        # Create SQLite database connection
        conn = sqlite3.connect(db_file)
        _ = conn.cursor()

        # Process all ASC files in the directory
        for file in os.listdir(asc_dir):
            if file.endswith(".asc"):  # Only process .asc files
                file_path = os.path.join(asc_dir, file)

                # Load ASC file into Pandas DataFrame (assuming semi-colon-separated values)
                df = pd.read_csv(file_path, sep=";", low_memory=False)

                # Use filename (without extension) as table name
                table_name = os.path.splitext(file)[0]

                # Save DataFrame to SQLite (creates table if not exists)
                df.to_sql(table_name, conn, if_exists="replace", index=False)

                print(f"Created table '{table_name}' and inserted data from {file}")

        conn.close()
        print(f"New SQLite database created at: {db_file}")

    except Exception as e:
        print(f"An error occurred: {e}")


if __name__ == "__main__":
    load_asc_files_to_sqlite(SQLITE_DB_FILE, ASC_FILE_DIR)
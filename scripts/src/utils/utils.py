import os
import yaml
from typing import Dict


def load_config(config_path: str) -> Dict:
    """
    Loads a YAML configuration file.
    """
    if not os.path.isabs(config_path):
        config_path = os.path.join(os.path.dirname(__file__), "..", "..", config_path)

    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Configuration file not found: {config_path}")

    with open(config_path, "r") as file:
        return yaml.safe_load(file)
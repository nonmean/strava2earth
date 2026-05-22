import sys
from pathlib import Path

# Add project root to path so `shared` package is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from app import app

if __name__ == "__main__":
    print("Starting strava2earth at http://localhost:5001")
    app.run(debug=True, port=5001)

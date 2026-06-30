"""Make the ``leon_db`` package importable when pytest collects this tree."""
import sys
from pathlib import Path

_PACKAGE_ROOT = Path(__file__).parent
if str(_PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_ROOT))

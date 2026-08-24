"""Pytest bootstrap for the WREN Writing Coach repo.

Adds the shared Python testing package (``testing/python``) to ``sys.path`` so
tests can ``import wren_testing`` without an editable install. Python Lambda
services scaffolded later under ``cdk/lambda`` can rely on the same helper.
"""
import sys
from pathlib import Path

_TESTING_PYTHON = Path(__file__).parent / "python"
if str(_TESTING_PYTHON) not in sys.path:
    sys.path.insert(0, str(_TESTING_PYTHON))

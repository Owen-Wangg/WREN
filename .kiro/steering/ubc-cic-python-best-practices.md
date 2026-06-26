---
title: Python Best Practices
inclusion: fileMatch
fileMatchPattern: "*.py"
---

# Python Best Practices

## Code Style
- Follow PEP 8 style guide
- Use meaningful variable and function names
- Use snake_case for variables and functions
- Use PascalCase for classes
- Use UPPER_SNAKE_CASE for constants
- Limit line length to 88 characters (Black formatter)

## Type Hints
- Use type hints for function parameters and return values
- Import types from `typing` module when needed
- Use `Optional` for nullable values
- Use `Union` for multiple possible types

## Error Handling
- Use specific exception types
- Handle exceptions at appropriate levels
- Use context managers (`with` statements) for resource management
- Log errors with appropriate detail

## Code Organization
- Use virtual environments for dependencies (prefer `uv venv`)
- Organize code into modules and packages
- Use `__init__.py` files appropriately

## Dependency & Package Management
- Use **uv** as the default tool for dependency and package management — it is significantly faster than pip/poetry/pipenv and provides reproducible installs
- Declare dependencies in `pyproject.toml`; use `uv add <pkg>` / `uv remove <pkg>` to manage them
- Pin dependencies and commit the `uv.lock` lock file for reproducible builds across environments
- Create and manage virtual environments with `uv venv`; install from the lock file with `uv sync`
- Run project commands and tools through the resolved environment with `uv run <command>`
- For Lambda/container builds, compile a pinned `requirements.txt` from your declared dependencies via `uv pip compile pyproject.toml -o requirements.txt` (replaces the `pip-compile` workflow)
- Use `uv python` to pin the interpreter version (target **Python 3.12**) so local and CI environments match
- Keep dependencies minimal and remove unused packages regularly

## Testing
- Write unit tests using pytest
- Use descriptive test function names
- Mock external dependencies
- Aim for high test coverage
- Use fixtures for test setup
- Run tests with minimal output: `pytest -q` or `python -m pytest --tb=short -q`
- Filter specific tests: `pytest -k "test_name"` to avoid running full suites

## Performance
- Use list comprehensions over loops when appropriate
- Use generators for large datasets
- Profile code before optimizing
- Use appropriate data structures (sets, dicts, etc.)

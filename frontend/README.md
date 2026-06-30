# LEON Writing Coach - Frontend (`frontend/`)

React 19 + Vite + Tailwind CSS + shadcn/ui single-page application for the
LEON Writing Coach platform.

## Status

Scaffolding placeholder. The frontend application is built out in Track B
(task 17.1 onward): feature-based structure, centralized design tokens, a
single Cognito-aware API client, and React Query with per-environment cache
keys.

## Prerequisites

- Node.js 22.x or newer

## Configuration

API endpoints come from build-time `VITE_`-prefixed environment variables
(commit a `.env.example`, never a real `.env`). Never hardcode endpoints.

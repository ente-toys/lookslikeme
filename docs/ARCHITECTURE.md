# Looks Like Us Architecture

## Overview

Looks Like Us is now a frontend-only web app. Users upload family photos in the browser, and all face detection, clustering, comparison, and trait analysis run locally in a Web Worker with ONNX Runtime Web.

There is no backend dependency in the runtime flow.

## Runtime Flow

1. The user adds 1-9 family photos in the upload screen.
2. The app sends the files to a browser worker.
3. The worker loads the active InsightFace model pack from the model CDN.
4. The worker detects all faces in each photo.
5. The worker clusters face embeddings across photos into candidate people.
6. The worker compares the discovered people pairwise.
7. The UI renders the closest family match for the selected face plus trait-level explanations.

## High-Level Components

### UI shell

- `frontend/src/App.tsx`
  - Owns the top-level page state.
  - Starts model preload.
  - Runs the analyze -> compare flow.
  - Switches between upload, processing, and results screens.

### Upload flow

- `frontend/src/components/FamilyPhotoForm.tsx`
  - Mobile-first upload UI.
  - Uses a tap-first picker on mobile and drag/drop on desktop.
  - Collects up to 9 photos before analysis starts.

### Processing UI

- `frontend/src/components/ProcessingOverlay.tsx`
  - Shows analysis and comparison progress.
  - Uses different copy for grouping vs resemblance matching.

### Results UI

- `frontend/src/components/ResultsPanel.tsx`
  - Displays the selected face, closest family match, runner-ups, and drill-down preview.
- `frontend/src/components/ResultCard.tsx`
  - Reusable ranked pair card.
- `frontend/src/components/FeatureBreakdownPanel.tsx`
  - Shows best and weakest facial trait match.
- `frontend/src/components/ScoreBar.tsx`
  - Compact face similarity bar.

### Browser ML boundary

- `frontend/src/api/client.ts`
  - Thin app-facing API surface.
- `frontend/src/ml/client.ts`
  - Thin local ML client wrapper.
- `frontend/src/ml/browserWorker.ts`
  - Main-thread worker transport.
  - Chooses the default model family.
- `frontend/src/ml/worker.ts`
  - Worker entrypoint.
  - Dispatches preload, analyze, and compare requests.

### ML pipeline

- `frontend/src/ml/pipeline.ts`
  - Validates image files.
  - Loads ONNX models.
  - Detects faces.
  - Aligns crops for embedding and landmark inference.
  - Clusters discovered faces into people.
  - Computes pairwise similarity and result payloads.
- `frontend/src/ml/featureAnalysis.ts`
  - Converts landmark geometry into trait-level explanations.

## Models

The app supports two InsightFace model packs:

- `buffalo_l`
  - Better quality, used by default on desktop-class devices.
- `buffalo_s`
  - Smaller and lighter, used by default on mobile/coarse-pointer devices.

Each pack uses:

- detector model
- recognition model
- `1k3d68.onnx` landmark model

The models are fetched from:

- `https://models.ente.io/lookslikeus/buffalo_l/...`
- `https://models.ente.io/lookslikeus/buffalo_s/...`

The base CDN root can be overridden with:

- `VITE_LLU_MODEL_ROOT`

## Caching Strategy

Model bytes are cached in IndexedDB in the browser. The pipeline also keeps sessions and model bytes in memory for the lifetime of the page.

Expected behavior:

- first load on a device downloads the active model pack
- later reloads should reuse cached model bytes when available

If model initialization fails because cached bytes are bad, the pipeline clears the cached entries for the active pack and retries once with a fresh download.

## Device-Specific Defaults

- desktop defaults to `buffalo_l`
- mobile or coarse-pointer devices default to `buffalo_s`

These can still be overridden with query params:

- `?model=buffalo_l`
- `?model=buffalo_s`

## Current Repository Shape

This repo intentionally keeps only the frontend application and docs. The old Python backend, parity scripts, and sample-family scaffolding have been removed from the main runtime codebase.

Important paths:

- `frontend/src/` for app and ML code
- `frontend/public/` for static assets
- `docs/ARCHITECTURE.md` for this document

## Local Development

From `frontend/`:

```bash
npm install
npm run dev
```

Dev server:

- `http://localhost:4173/`

## Production Assumptions

- the browser can fetch ONNX model files from `models.ente.io`
- CDN responses allow cross-origin requests from the app origin
- CDN responses should ideally use long-lived immutable caching headers because the model files are large

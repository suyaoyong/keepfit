# KeepFit WeChat Mini Program

KeepFit is a WeChat Mini Program based on the Convict Conditioning training system.
It provides planning, daily workout tracking, progress views, feedback submission, and EPUB reading with cloud sync.

## Features
- Core tabs: Daily Workout / Progress / Mine
- Plan setup and cloud schedule persistence
- Daily workout logging and history backfill
- Progress calendar and stage-based tracking
- AI-related entry points and profile fields (as implemented in UI)
- Feedback form on Mine page (writes to cloud collection: feedback)
- EPUB library and reader:
  - Book list, chapter list, chapter reading, reading progress save
  - Auto cover upload
  - Inline image extraction/upload/render
  - Responsive images + tap-to-preview in reader page

## Tech Structure
- Mini Program frontend: miniprogram/
- Cloud functions: cloudfunctions/
- Specs and logs: specs/
- Import/transform tools: tools/

## Main Pages
- pages/workout-today: Daily workout
- pages/progress: Progress
- pages/mine: Mine
- pages/plan-setup: Plan setup
- pages/workout-history: Workout history
- pages/library: Book library
- pages/book-detail: Book chapter list
- pages/reader: Reader

## Main Cloud Functions
- auth
- plan
- schedule
- workout
- progress
- diary
- profile
- ai-parse
- feedback
- library

## Prerequisites
- WeChat DevTools with Cloud Development enabled
- Node.js (for local scripts)
- A valid cloud environment ID (configured in miniprogram/app.js)

## Quick Start
1. Open this repository in WeChat DevTools.
2. Confirm cloud env ID matches miniprogram/app.js.
3. Deploy cloud functions at least:
   - auth, plan, schedule, workout, progress, diary, profile, feedback, library, ai-parse
4. Create required database collections.
5. Build and run on simulator / real device.

## Required Collections
Training flow:
- auth
- profile
- plans
- schedules
- workouts
- diaries
- progress

Feedback and reading:
- feedback
- books
- book_chapters
- book_progress

Tip: use strict dev-only permissions first, then harden before release.

## EPUB Import (Cover + Inline Images)
Current pipeline: local preprocessing + library seed import.

### 1) Preprocess EPUB
Run in repo root:

```bash
python tools/epub_to_cloud_json.py --epub "ConvictConditioning.epub" --out "data/epub-import/qiutu" --book-id "qiutujianshen"
```

For your current local file name:

```bash
python tools/epub_to_cloud_json.py --epub "<your-book>.epub" --out "data/epub-import/qiutu" --book-id "qiutujianshen"
```

This script will:
- generate books.json and book_chapters.json
- extract cover to cloudfunctions/library/seed/qiutu-cover.jpg
- extract chapter images to cloudfunctions/library/seed/assets/qiutujianshen/

### 2) Sync seed JSON into cloud function seed folder
PowerShell:

```powershell
Copy-Item -Force data/epub-import/qiutu/books.json cloudfunctions/library/seed/books.qiutu.json
Copy-Item -Force data/epub-import/qiutu/book_chapters.json cloudfunctions/library/seed/book_chapters.qiutu.json
```

### 3) Redeploy library cloud function
Set timeout to 60-120s (image upload in seedQiutu needs more than default 3s).

### 4) Run seed import
Cloud function test payload:

```json
{
  "action": "seedQiutu"
}
```

If LIBRARY_SEED_TOKEN is configured, include seedToken.

## Reader Image Rendering
- seedQiutu uploads seed assets and replaces placeholder image URLs in chapter HTML.
- Reader resolves cloud:// image IDs to temporary HTTPS URLs via wx.cloud.getTempFileURL.
- Reader image behavior:
  - Responsive width (widthFix + width: 100%)
  - Tap image to open wx.previewImage (zoom and swipe)

## Common Issues
### seedQiutu timeout after 3 seconds
Cause: cloud function timeout too low.
Fix: increase library timeout to 60-120s and retry.

### feedback collection not exists
Cause: missing feedback collection.
Fix: create feedback collection and retry submission.

### Cover shows but chapter images do not
Usually seed/redeploy mismatch.
Fix: rerun the 4 EPUB import steps and recompile mini program.

## Local Verification Checklist
- Mini Program compiles successfully
- library.seedQiutu returns success
- Open a chapter with images and verify:
  - images are visible
  - images fit screen width
  - tapping image opens preview

## Repo Layout (Short)
- cloudfunctions/: cloud function source
- miniprogram/: mini program source
- tools/: import and transform scripts
- data/: local import artifacts (usually not committed)
- specs/: specs, tasks, worklogs

## Notes
- This project evolves quickly; README should be updated with each major behavior change.
- If you add new cloud functions, collections, or pages, update this README in the same PR.

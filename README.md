# Directus Video Sizes Hook

A Custom API Hook extension for Directus CMS to add width and height metadata to videos in the File Library.

Unlike images, videos get no width and height attributes on upload. This extension adds them, automatically or manually with tags, to they can be served with video assets for use on the front-end.

## Requirements

Requires Directus to be running in an environment with `ffmpeg` installed, and for the user Directus runs as to have permissions to run it. The extension uses `ffprobe`, which is part of a standard `ffmpeg` installation.

## Installation

1. Download repo.
2. Run `npm build` to compile.
3. Move the repo folder into the `/extensions` directory of your Directus installation.
4. Restart Directus.

Check the hook is running under Settings > Extensions. It should show under Hooks. If not, you probably need to install `ffmpeg` to your server or container and make it available to the user Directus runs as.

## Usage

### Auto-dimensions

The extension polls for new locally-stored videos every 10 seconds and automatically detects and adds dimensions.

### Manual dimensions via tag

For CDN hosted videos, dimensions can’t be auto-detected by ffmpeg. Add a tag to the video asset in File Library in the format `reprocess:<width>x<height>` where width and height are integers, e.g. `reprocess:1920x1080`. The hook will add the width and height you specify in the tag on next run.

You can also add manual dimensions via tags to locally-hosted videos, if needed.

### Reprocessing

To flag a locally-hosted video to have its dimensions re-calculated, add the tag `reprocess`. The width and height will be auto-calculated on the next run.

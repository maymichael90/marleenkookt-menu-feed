
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday at 06:00 UTC
  workflow_dispatch:
    inputs:
      action:
        description: 'What to run'
        required: true
        default: 'sync'
        type: choice
        options:
          - sync
          - delete-all

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run sync
        if: ${{ github.event.inputs.action == 'sync' || github.event_name == 'schedule' }}
        run: node scripts/sync-klaviyo.js
        env:
          KLAVIYO_API_KEY: ${{ secrets.KLAVIYO_API_KEY }}

      - name: Delete all items
        if: ${{ github.event.inputs.action == 'delete-all' }}
        run: node scripts/delete-all-items.js
        env:
          KLAVIYO_API_KEY: ${{ secrets.KLAVIYO_API_KEY }}

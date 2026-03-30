# SinByte (SendByte) Indexing API Reference

The service is at sinbyte.com (not "sendbyte" — Casey may have misspelled it).

## API Endpoint
- Base URL: `https://app.sinbyte.com/api/indexing/`
- Auth: API key passed in the request body

## Create Quick Indexing Task
POST `https://app.sinbyte.com/api/indexing/`
```json
{
  "apikey": "YOUR_API_KEY",
  "name": "Task Name",
  "dripfeed": 1,
  "urls": [
    "https://example.com/page1",
    "https://example.com/page2"
  ]
}
```

## Get Indexing History
GET `https://app.sinbyte.com/api/indexing/?apikey=YOUR_API_KEY`

## Get Task Details
GET `https://app.sinbyte.com/api/indexing/{task_id}/?apikey=YOUR_API_KEY`

## Notes
- API key is obtained from the Quick Submit Links menu in app.sinbyte.com
- Has a WordPress plugin: https://wordpress.org/plugins/sinbyte-indexer/
- Credits don't expire until used

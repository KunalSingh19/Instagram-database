# Instagram-database
Here is a simple script to create a database of instagram scraped video uses third part software so may hide some content even normal ones. Need public ip doesnt work on cloud most of the time

Example: 

---

# Instagram Reels Fetch & Download Script

This Node.js script fetches Instagram reel metadata from a list of URLs and downloads the associated videos. It handles errors gracefully and stops processing if a 401 Unauthorized error is encountered.

---

## Prerequisites

- Node.js v16+ installed
- Internet connection
- Instagram reel URLs to process

---

## Setup

1. Clone or download this repository.

2. Install dependencies:

```bash
npm install instagram-url-direct p-limit sanitize-filename
```

3. Prepare a text file (default: `reels.txt`) with one Instagram reel URL per line, for example:

```
https://www.instagram.com/reel/XXXXXXXXXXX/
https://www.instagram.com/reel/YYYYYYYYYYY/
```

---

## Usage

Run the script with:

```bash
node index.js [inputFile] [asc]
```

- `inputFile` (optional): Path to the text file containing reel URLs. Defaults to `reels.txt`.
- `asc` (optional): Pass `asc` to process URLs in ascending order (oldest first). Defaults to descending order.

Example:

```bash
node index.js reels.txt asc
```

---

## Output

- `reelsData.json`: JSON file storing fetched reel metadata.
- `history.json`: (Optional) Previously processed URLs to skip.
- `fetchErrors.json`: Logs URLs that failed to fetch.
- `brokenLinks.json`: Logs URLs with broken or missing media.
- `videos/`: Directory where downloaded videos are saved.

---

# filter

run
```
python filter.py
```

it filters and remove expired url and replace url path with url path


---

## Notes

- The script stops fetching or downloading immediately if a 401 Unauthorized error is encountered.
- Already downloaded videos are skipped to avoid duplicates.
- Maximum batch size and concurrency can be adjusted in the script constants.

---

## Troubleshooting

- Ensure URLs are valid Instagram reel links.
- Check your internet connection.
- If you encounter frequent 401 errors, Instagram may have restricted access; consider using authenticated API or proxies.

---

Feel free to customize this repo with your scripts and files!

import json
import os
import shutil
from urllib.parse import urlparse

# Load the JSON data
with open('instagram_data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# List of entries (values from the dict)
entries = list(data.values())

# Number of videos (assuming one per entry)
total_videos = len(entries)
batch_size = 100

print(f"Processing {total_videos} videos into batches of {batch_size}.")

for i in range(0, total_videos, batch_size):
    batch_entries = entries[i:i + batch_size]
    batch_num = (i // batch_size) + 1
    batch_folder = f"batch_{batch_num}"
    
    # Create batch folder and subfolders
    os.makedirs(batch_folder, exist_ok=True)
    videos_subfolder = os.path.join(batch_folder, 'videos')
    data_subfolder = os.path.join(batch_folder, 'data')
    os.makedirs(videos_subfolder, exist_ok=True)
    os.makedirs(data_subfolder, exist_ok=True)
    
    print(f"Creating batch {batch_num} with {len(batch_entries)} videos.")
    
    for idx, entry in enumerate(batch_entries):
        # Get video URL (from url_list[0])
        video_rel_path = entry['url_list'][0]
        video_full_path = os.path.join('videos', video_rel_path)
        
        if not os.path.exists(video_full_path):
            print(f"Warning: Video not found at {video_full_path}, skipping.")
            continue
        
        # Extract shortcode from the original URL key (we need to map back, but since entries are in order, use index or assume sequential)
        # Note: Since JSON keys are URLs, we iterate over items to get keys
        # Restart iteration over data.items() for accuracy
        # Actually, to get the URL key for each entry, better to iterate over data.items()
    
# Corrected version: Iterate over data.items() to access keys
data = json.load(open('instagram_data.json', 'r', encoding='utf-8'))
batch_num = 1
entries_list = list(data.items())  # List of (url_key, entry)

for i in range(0, len(entries_list), batch_size):
    batch_items = entries_list[i:i + batch_size]
    batch_folder = f"batch_{batch_num}"
    videos_subfolder = os.path.join(batch_folder, 'videos')
    data_subfolder = os.path.join(batch_folder, 'data')
    os.makedirs(videos_subfolder, exist_ok=True)
    os.makedirs(data_subfolder, exist_ok=True)
    
    for url_key, entry in batch_items:
        # Extract shortcode from URL (e.g., DFHpq6aylJh from /reel/DFHpq6aylJh/)
        parsed_url = urlparse(url_key)
        path_parts = parsed_url.path.split('/')
        shortcode = path_parts[-2] if len(path_parts) > 2 and path_parts[-1] == '' else path_parts[-1]
        
        # Video path
        video_rel_path = entry['url_list'][0]
        video_full_path = os.path.join('videos', video_rel_path)
        video_filename = os.path.basename(video_rel_path)
        new_video_path = os.path.join(videos_subfolder, video_filename)
        
        # Move video if exists
        if os.path.exists(video_full_path):
            shutil.move(video_full_path, new_video_path)
            print(f"Moved video: {video_filename} to {batch_folder}/videos/")
        else:
            print(f"Warning: {video_full_path} not found.")
        
        # Save data as JSON with shortcode name
        data_filename = f"{shortcode}.json"
        data_path = os.path.join(data_subfolder, data_filename)
        # Save the full entry (post_info, media_details, etc.)
        with open(data_path, 'w', encoding='utf-8') as df:
            json.dump(entry, df, indent=4, ensure_ascii=False)
        print(f"Saved data: {data_filename} to {batch_folder}/data/")
    
    batch_num += 1

print("Processing complete. Videos and matching data organized into batches.")

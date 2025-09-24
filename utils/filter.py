import json
import shutil
import os

def load_json(file_path):
    """Load JSON from file."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Input file '{file_path}' not found. Please create it with the JSON data.")
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def create_backup(input_file, backup_file):
    """Create a file-level backup of the input JSON."""
    shutil.copy2(input_file, backup_file)
    print(f"Backup created: {backup_file}")

def update_urls_in_entry(entry, local_path):
    """Update 'url' fields in a single entry with the local_media_path, then remove local_media_path and thumbnail."""
    updated = False
    removed = False
    
    # Update url_list (replace first item if list exists)
    if 'url_list' in entry and isinstance(entry['url_list'], list) and len(entry['url_list']) > 0:
        entry['url_list'][0] = local_path  # Assuming single URL; replace first one
        updated = True
        print(f"  - Updated url_list[0] to: '{local_path}'")
    
    # Update media_details[0].url (assuming single media detail)
    if 'media_details' in entry and isinstance(entry['media_details'], list) and len(entry['media_details']) > 0:
        media = entry['media_details'][0]
        if isinstance(media, dict) and 'url' in media:
            media['url'] = local_path
            updated = True
            print(f"  - Updated media_details[0].url to: '{local_path}'")
        
        # Remove thumbnail from media_details[0] if it exists
        if isinstance(media, dict) and 'thumbnail' in media:
            del media['thumbnail']
            removed = True
            print(f"  - Removed 'thumbnail' from media_details[0]")
    
    if not updated:
        print("  Warning: No 'url' fields found to update in this entry.")
    
    # Remove local_media_path after using it
    if 'local_media_path' in entry:
        del entry['local_media_path']
        removed = True
        print(f"  - Removed 'local_media_path'")
    
    if removed:
        print(f"  - Removals completed for this entry.")
    else:
        print("  Warning: No fields found to remove in this entry.")
    
    return entry

def main():
    input_file = 'input.json'
    backup_file = 'backup.json'
    output_file = 'output.json'
    
    # Load the JSON data
    data = load_json(input_file)
    
    # Create backup
    create_backup(input_file, backup_file)
    
    # Process each entry (top-level keys are Instagram URLs)
    if isinstance(data, dict):
        for key, entry in data.items():
            if isinstance(entry, dict) and 'local_media_path' in entry:
                local_path = entry['local_media_path']
                print(f"Processing entry for {key}: Using local path '{local_path}'")
                update_urls_in_entry(entry, local_path)
            else:
                print(f"Warning: Skipping entry for {key} (missing 'local_media_path').")
    else:
        raise ValueError("Input JSON must be a dictionary.")
    
    # Save modified JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    
    print(f"\nModified JSON saved to: {output_file}")
    print("Done! Check output.json for updates (URLs updated, local_media_path and thumbnail removed).")

# Alternative: If you want to hardcode the JSON instead of reading from file, uncomment below and comment out the load_json call.
# def hardcoded_data():
#     json_str = '''{  # Paste your full JSON string here
# "https://www.instagram.com/reel/DNCe93iJEzE/": { ... }  # etc.
#     }'''
#     return json.loads(json_str)
#
# Then in main(): data = hardcoded_data()

if __name__ == "__main__":
    main()

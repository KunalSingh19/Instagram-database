import json
import sys
import os

def remove_reel_data(json_file_path, reel_url):
    """
    Remove the entry for a specific reel URL from the JSON file.
    
    Args:
    json_file_path (str): Path to the JSON file.
    reel_url (str): The exact reel URL to remove.
    
    Returns:
    bool: True if removal successful, False otherwise.
    """
    if not os.path.exists(json_file_path):
        print(f"Error: File '{json_file_path}' not found.")
        return False
    
    try:
        with open(json_file_path, 'r', encoding='utf-8') as file:
            data = json.load(file)
        
        if reel_url not in data:
            print(f"Warning: Reel URL '{reel_url}' not found in the JSON.")
            return False
        
        # Remove the entry
        del data[reel_url]
        
        # Write back to file
        with open(json_file_path, 'w', encoding='utf-8') as file:
            json.dump(data, file, indent=2, ensure_ascii=False)
        
        print(f"Successfully removed data for reel URL: {reel_url}")
        return True
    
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in file: {e}")
        return False
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python remove_reel.py <json_file_path> <reel_url>")
        sys.exit(1)
    
    json_file = sys.argv[1]
    reel_url = sys.argv[2]
    
    remove_reel_data(json_file, reel_url)

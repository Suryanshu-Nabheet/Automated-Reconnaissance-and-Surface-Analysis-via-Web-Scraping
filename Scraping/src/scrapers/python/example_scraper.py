#!/usr/bin/env python3
"""
Example Python Scraper

This module demonstrates a simple web scraper using requests and BeautifulSoup.
It extracts basic information from a website and stores it in JSON format.
"""

import os
import sys
import json
import time
import logging
import requests
from typing import Dict, List, Any, Optional
from bs4 import BeautifulSoup
import random
from datetime import datetime

# Set up logging
logger = logging.getLogger("example_scraper")

# Define the data schema
SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "url": {"type": "string", "format": "uri"},
        "description": {"type": "string"},
        "timestamp": {"type": "string", "format": "date-time"},
        "tags": {
            "type": "array",
            "items": {"type": "string"}
        },
        "metadata": {
            "type": "object",
            "properties": {
                "source": {"type": "string"},
                "author": {"type": "string"},
                "published_date": {"type": "string"}
            }
        }
    },
    "required": ["title", "url", "timestamp"]
}


class ExampleScraper:
    """A sample web scraper implementation."""
    
    def __init__(self, config: Dict[str, Any], output_paths: Dict[str, str]):
        """
        Initialize the scraper with configuration and output paths.
        
        Args:
            config: Configuration dictionary containing scraping parameters
            output_paths: Dictionary with paths for different output types
        """
        self.config = config
        self.output_paths = output_paths
        self.session = requests.Session()
        self.stats = {
            "start_time": datetime.now().isoformat(),
            "pages_visited": 0,
            "items_scraped": 0,
            "errors": 0,
            "bytes_downloaded": 0
        }
        
        # Set up request headers to mimic a browser
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1"
        })
        
        # Create output directories if they don't exist
        for path in output_paths.values():
            os.makedirs(path, exist_ok=True)
        
        # Save the schema
        schema_path = os.path.join(output_paths["schemas"], "schema.json")
        with open(schema_path, 'w') as f:
            json.dump(SCHEMA, f, indent=2)
        
        logger.info(f"Initialized example scraper with target URL: {self.config.get('url', 'Not specified')}")
    
    def scrape(self) -> List[Dict[str, Any]]:
        """
        Execute the scraping process.
        
        Returns:
            List of scraped items
        """
        target_url = self.config.get("url", "https://example.com")
        selectors = self.config.get("selectors", {
            "title": "h1",
            "content": "div.content",
            "links": "a",
            "metadata": "meta"
        })
        
        logger.info(f"Starting scrape of {target_url}")
        
        try:
            # Get the main page
            start_time = time.time()
            response = self.session.get(target_url, timeout=30)
            response.raise_for_status()  # Raise an exception for HTTP errors
            
            # Update stats
            self.stats["pages_visited"] += 1
            self.stats["bytes_downloaded"] += len(response.content)
            
            # Parse HTML
            soup = BeautifulSoup(response.text, 'html.parser')
            logger.info(f"Successfully downloaded and parsed {target_url}")
            
            # Extract data based on selectors
            title = soup.select_one(selectors.get("title", "h1"))
            title_text = title.text.strip() if title else "No Title Found"
            
            content = soup.select_one(selectors.get("content", "div.content"))
            content_text = content.text.strip() if content else "No Content Found"
            
            # Extract all links
            links = soup.select(selectors.get("links", "a"))
            extracted_links = []
            for link in links[:5]:  # Limit to first 5 links
                href = link.get('href')
                if href and not href.startswith('#'):  # Skip anchor links
                    # Handle relative URLs
                    if not href.startswith(('http://', 'https://')):
                        href = f"{target_url.rstrip('/')}/{href.lstrip('/')}"
                    extracted_links.append({
                        "url": href,
                        "text": link.text.strip()
                    })
            
            # Create items
            items = []
            main_item = {
                "title": title_text,
                "url": target_url,
                "description": content_text[:200] + "..." if len(content_text) > 200 else content_text,
                "timestamp": datetime.now().isoformat(),
                "tags": ["example", "demonstration", "sample"],
                "metadata": {
                    "source": "example_scraper",
                    "author": "Automated Scraper",
                    "published_date": datetime.now().strftime("%Y-%m-%d")
                }
            }
            items.append(main_item)
            
            # Add some sample items from the extracted links
            for link in extracted_links:
                item = {
                    "title": link["text"] or "Link without text",
                    "url": link["url"],
                    "description": f"Link found on {target_url}",
                    "timestamp": datetime.now().isoformat(),
                    "tags": ["link", "reference"],
                    "metadata": {
                        "source": "example_scraper",
                        "author": "Unknown",
                        "published_date": datetime.now().strftime("%Y-%m-%d")
                    }
                }
                items.append(item)
            
            # Simulate varying processing times
            processing_time = random.uniform(0.5, 2.0)
            time.sleep(processing_time)
            
            # Update stats
            self.stats["items_scraped"] += len(items)
            logger.info(f"Extracted {len(items)} items from {target_url}")
            
            return items
            
        except requests.RequestException as e:
            logger.error(f"Request error: {str(e)}")
            self.stats["errors"] += 1
            return []
            
        except Exception as e:
            logger.error(f"Scraping error: {str(e)}")
            self.stats["errors"] += 1
            return []
        
    def save_data(self, items: List[Dict[str, Any]]) -> None:
        """
        Save the scraped data to files.
        
        Args:
            items: List of scraped data items
        """
        if not items:
            logger.warning("No items to save")
            return
        
        try:
            # Save as JSON
            data_file = os.path.join(self.output_paths["data"], "items.json")
            with open(data_file, 'w') as f:
                json.dump(items, f, indent=2)
            
            # Save individual items
            items_dir = os.path.join(self.output_paths["data"], "items")
            os.makedirs(items_dir, exist_ok=True)
            
            for i, item in enumerate(items):
                item_file = os.path.join(items_dir, f"item_{i+1}.json")
                with open(item_file, 'w') as f:
                    json.dump(item, f, indent=2)
            
            # Create a simple export in different format (CSV-like)
            export_file = os.path.join(self.output_paths["exports"], "items_export.txt")
            with open(export_file, 'w') as f:
                f.write("Title,URL,Description\n")
                for item in items:
                    # Escape commas in fields
                    title = item["title"].replace(",", "\\,")
                    url = item["url"]
                    description = item["description"].replace(",", "\\,") if "description" in item else ""
                    f.write(f"{title},{url},{description}\n")
            
            logger.info(f"Saved {len(items)} items to {data_file} and exported to {export_file}")
            
        except Exception as e:
            logger.error(f"Error saving data: {str(e)}")
            self.stats["errors"] += 1
    
    def generate_report(self) -> Dict[str, Any]:
        """
        Generate a report of the scraping process.
        
        Returns:
            Dictionary containing scraping statistics
        """
        # Calculate elapsed time
        if "start_time" in self.stats:
            start_time = datetime.fromisoformat(self.stats["start_time"])
            elapsed = (datetime.now() - start_time).total_seconds()
        else:
            elapsed = 0
        
        # Update final stats
        self.stats["end_time"] = datetime.now().isoformat()
        self.stats["elapsed_seconds"] = elapsed
        
        # Save report
        report_file = os.path.join(self.output_paths["data"], "report.json")
        with open(report_file, 'w') as f:
            json.dump(self.stats, f, indent=2)
        
        logger.info(f"Generated scraping report: {report_file}")
        return self.stats


def run(config: Dict[str, Any], output_paths: Dict[str, str]) -> Dict[str, Any]:
    """
    Run the scraper with the given configuration.
    
    Args:
        config: Configuration dictionary
        output_paths: Dictionary with paths for different output types
        
    Returns:
        Dictionary containing scraping results and statistics
    """
    try:
        # Initialize and run the scraper
        scraper = ExampleScraper(config, output_paths)
        items = scraper.scrape()
        scraper.save_data(items)
        report = scraper.generate_report()
        
        return {
            "success": True,
            "items_scraped": len(items),
            "stats": report
        }
        
    except Exception as e:
        logger.error(f"Error running scraper: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        
        return {
            "success": False,
            "error": str(e),
            "items_scraped": 0
        }


if __name__ == "__main__":
    # This allows the scraper to be run directly for testing
    import argparse
    
    parser = argparse.ArgumentParser(description="Example web scraper")
    parser.add_argument("--url", default="https://example.com", help="URL to scrape")
    parser.add_argument("--output", default="./output", help="Output directory")
    args = parser.parse_args()
    
    # Setup basic logging to console
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Create simple config and output paths
    config = {
        "url": args.url,
        "selectors": {
            "title": "h1",
            "content": "div",
            "links": "a",
        }
    }
    
    output_dir = args.output
    output_paths = {
        "data": os.path.join(output_dir, "data"),
        "exports": os.path.join(output_dir, "exports"),
        "schemas": os.path.join(output_dir, "schemas")
    }
    
    # Run the scraper
    result = run(config, output_paths)
    print(json.dumps(result, indent=2))


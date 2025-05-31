#!/usr/bin/env python3
"""
News Website Scraper

This module implements a news website scraper that extracts articles,
publication dates, authors, and categories from news websites.
"""

import os
import sys
import json
import time
import logging
import requests
import datetime
from typing import Dict, List, Any, Optional, Tuple
from bs4 import BeautifulSoup
import re
from urllib.parse import urljoin, urlparse
import random
import dateutil.parser
from readability import Document
import html2text

# Set up logging
logger = logging.getLogger("news_scraper")

# Define the data schema for news articles
SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "url": {"type": "string", "format": "uri"},
        "content": {"type": "string"},
        "summary": {"type": "string"},
        "published_date": {"type": "string", "format": "date-time"},
        "author": {"type": "string"},
        "categories": {
            "type": "array",
            "items": {"type": "string"}
        },
        "image_url": {"type": "string", "format": "uri"},
        "source": {"type": "string"},
        "scraped_at": {"type": "string", "format": "date-time"}
    },
    "required": ["title", "url", "content", "scraped_at"]
}


class NewsArticle:
    """Class representing a news article."""
    
    def __init__(self, url: str):
        """
        Initialize a news article with its URL.
        
        Args:
            url: The URL of the article
        """
        self.url = url
        self.title = ""
        self.content = ""
        self.summary = ""
        self.published_date = None
        self.author = "Unknown"
        self.categories = []
        self.image_url = ""
        self.source = ""
        self.scraped_at = datetime.datetime.now().isoformat()
    
    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the article to a dictionary.
        
        Returns:
            Dictionary representation of the article
        """
        return {
            "title": self.title,
            "url": self.url,
            "content": self.content,
            "summary": self.summary,
            "published_date": self.published_date,
            "author": self.author,
            "categories": self.categories,
            "image_url": self.image_url,
            "source": self.source,
            "scraped_at": self.scraped_at
        }


class NewsScraper:
    """A news website scraper implementation."""
    
    def __init__(self, config: Dict[str, Any], output_paths: Dict[str, str]):
        """
        Initialize the news scraper with configuration and output paths.
        
        Args:
            config: Configuration dictionary containing scraping parameters
            output_paths: Dictionary with paths for different output types
        """
        self.config = config
        self.output_paths = output_paths
        self.session = requests.Session()
        self.stats = {
            "start_time": datetime.datetime.now().isoformat(),
            "pages_visited": 0,
            "articles_scraped": 0,
            "errors": 0,
            "bytes_downloaded": 0
        }
        
        # Configure session
        self.session.headers.update({
            "User-Agent": self.config.get("python_specific", {}).get(
                "user_agent", 
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5"
        })
        
        # Create output directories
        for path in output_paths.values():
            os.makedirs(path, exist_ok=True)
        
        # Save the schema
        schema_path = os.path.join(output_paths["schemas"], "news_schema.json")
        with open(schema_path, 'w') as f:
            json.dump(SCHEMA, f, indent=2)
        
        # Get base URL from the target URL
        self.base_url = self._get_base_url(self.config.get("url", ""))
        
        logger.info(f"Initialized news scraper with target URL: {self.config.get('url', 'Not specified')}")
    
    def _get_base_url(self, url: str) -> str:
        """
        Extract the base URL from a given URL.
        
        Args:
            url: The URL to parse
            
        Returns:
            The base URL (scheme + netloc)
        """
        if not url:
            return ""
        
        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}"
    
    def _make_absolute_url(self, url: str) -> str:
        """
        Convert a relative URL to an absolute URL.
        
        Args:
            url: The URL to convert
            
        Returns:
            Absolute URL
        """
        if not url:
            return ""
        
        if url.startswith(('http://', 'https://')):
            return url
        
        return urljoin(self.base_url, url)
    
    def _parse_date(self, date_str: str) -> Optional[str]:
        """
        Parse a date string into ISO format.
        
        Args:
            date_str: Date string to parse
            
        Returns:
            ISO formatted date string or None if parsing fails
        """
        if not date_str:
            return None
        
        try:
            # Clean up the date string
            date_str = re.sub(r'\s+', ' ', date_str).strip()
            
            # Try to parse the date
            dt = dateutil.parser.parse(date_str)
            return dt.isoformat()
        except Exception as e:
            logger.debug(f"Date parsing error: {str(e)} for '{date_str}'")
            return None
    
    def _clean_text(self, text: str) -> str:
        """
        Clean text by removing extra whitespace.
        
        Args:
            text: Text to clean
            
        Returns:
            Cleaned text
        """
        if not text:
            return ""
        
        # Replace multiple whitespace with a single space
        text = re.sub(r'\s+', ' ', text)
        
        # Remove leading/trailing whitespace
        return text.strip()
    
    def _extract_main_image(self, soup: BeautifulSoup, selectors: Dict[str, str]) -> str:
        """
        Extract the main image URL from the article.
        
        Args:
            soup: BeautifulSoup object of the article page
            selectors: Selectors for finding elements
            
        Returns:
            URL of the main image or empty string if not found
        """
        image_selector = selectors.get("image", "meta[property='og:image']")
        
        try:
            # Try meta tags first (common for news sites)
            meta_img = soup.select_one(image_selector)
            if meta_img and meta_img.get("content"):
                return self._make_absolute_url(meta_img.get("content"))
            
            # Try direct image tags
            img_tag = soup.select_one("article img") or soup.select_one(".article-body img") or soup.select_one(".content img")
            if img_tag and img_tag.get("src"):
                return self._make_absolute_url(img_tag.get("src"))
            
            # Try figure tags
            figure = soup.select_one("figure img")
            if figure and figure.get("src"):
                return self._make_absolute_url(figure.get("src"))
            
            return ""
        except Exception as e:
            logger.debug(f"Error extracting image: {str(e)}")
            return ""
    
    def _extract_categories(self, soup: BeautifulSoup, selectors: Dict[str, str]) -> List[str]:
        """
        Extract article categories.
        
        Args:
            soup: BeautifulSoup object of the article page
            selectors: Selectors for finding elements
            
        Returns:
            List of categories
        """
        categories = []
        category_selector = selectors.get("categories", ".category a, .categories a, .tags a")
        
        try:
            category_elements = soup.select(category_selector)
            for element in category_elements:
                category = element.text.strip()
                if category and category not in categories:
                    categories.append(category)
            
            return categories
        except Exception as e:
            logger.debug(f"Error extracting categories: {str(e)}")
            return []
    
    def get_article_links(self) -> List[str]:
        """
        Get a list of article links from the main page.
        
        Returns:
            List of article URLs
        """
        target_url = self.config.get("url", "")
        if not target_url:
            logger.error("No target URL specified")
            return []
        
        selectors = self.config.get("selectors", {})
        links_selector = selectors.get("links", "a.article-link, a.headline, article a")
        
        logger.info(f"Getting article links from {target_url}")
        
        try:
            # Get the main page
            response = self.session.get(
                target_url, 
                timeout=30,
                verify=self.config.get("python_specific", {}).get("verify_ssl", True)
            )
            response.raise_for_status()
            
            # Update stats
            self.stats["pages_visited"] += 1
            self.stats["bytes_downloaded"] += len(response.content)
            
            # Parse HTML
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Find article links
            article_links = []
            link_elements = soup.select(links_selector)
            
            for link in link_elements:
                href = link.get('href')
                if href and not href.startswith('#'):
                    absolute_url = self._make_absolute_url(href)
                    if absolute_url and absolute_url not in article_links:
                        article_links.append(absolute_url)
            
            logger.info(f"Found {len(article_links)} article links")
            return article_links[:10]  # Limit to 10 articles for demo purposes
            
        except requests.RequestException as e:
            logger.error(f"Request error while getting article links: {str(e)}")
            self.stats["errors"] += 1
            return []
            
        except Exception as e:
            logger.error(f"Error getting article links: {str(e)}")
            self.stats["errors"] += 1
            return []
    
    def scrape_article(self, url: str) -> Optional[NewsArticle]:
        """
        Scrape a single news article.
        
        Args:
            url: URL of the article to scrape
            
        Returns:
            NewsArticle object or None if scraping fails
        """
        logger.info(f"Scraping article: {url}")
        
        selectors = self.config.get("selectors", {})
        
        try:
            # Get the article page
            response = self.session.get(
                url, 
                timeout=30,
                verify=self.config.get("python_specific", {}).get("verify_ssl", True)
            )
            response.raise_for_status()
            
            # Update stats
            self.stats["pages_visited"] += 1
            self.stats["bytes_downloaded"] += len(response.content)
            
            # Create article object
            article = NewsArticle(url)
            article.source = self.base_url
            
            # Parse HTML
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract title
            title_selector = selectors.get("title", "h1.headline, h1.title, article h1")
            title_element = soup.select_one(title_selector)
            if title_element:
                article.title = self._clean_text(title_element.text)
            else:
                # Fallback to document title
                article.title = self._clean_text(soup.title.text) if soup.title else "No Title"
            
            # Use readability for content extraction
            doc = Document(response.text)
            article.content = doc.summary()
            
            # Convert HTML content to plain text for summary
            h = html2text.HTML2Text()
            h.ignore_links = True
            h.ignore_images = True
            plain_text = h.handle(article.content)
            
            # Create a summary (first 200 chars)
            article.summary = self._clean_text(plain_text[:500]) + "..."
            
            # Extract published date
            date_selector = selectors.get("published_date", "time, .date, .published-date, meta[property='article:published_time']")
            date_element = soup.select_one(date_selector)
            
            if date_element:
                # Check if it's a meta tag or regular element
                if date_element.name == "meta":
                    date_str = date_element.get("content")
                else:
                    date_str = date_element.text
                
                article.published_date = self._parse_date(date_str)
            
            # Extract author
            author_selector = selectors.get("author", ".author, .byline, meta[name='author']")
            author_element = soup.select_one(author_selector)
            
            if author_element:
                if author_element.name == "meta":
                    article.author = author_element.get("content")
                else:
                    article.author = self._clean_text(author_element.text)
                    # Remove common prefixes like "By "
                    article.author = re.sub(r'^By\s+', '', article.author, flags=re.IGNORECASE)
            
            # Extract categories
            article.categories = self._extract_categories(soup, selectors)
            
            # Extract main image
            article.image_url = self._extract_main_image(soup, selectors)
            
            logger.info(f"Successfully scraped article: {article.title}")
            
            # Add some delay to prevent rate limiting
            time.sleep(random.uniform(1, 3))
            
            return article
            
        except requests.RequestException as e:
            logger.error(f"Request error while scraping article: {str(e)}")
            self.stats["errors"] += 1
            return None
            
        except Exception as e:
            logger.error(f"Error scraping article: {str(e)}")
            self.stats["errors"] += 1
            return None
    
    def scrape(self) -> List[Dict[str, Any]]:
        """
        Execute the scraping process for multiple articles.
        
        Returns:
            List of scraped articles as dictionaries
        """
        # Get article links
        article_links = self.get_article_links()
        if not article_links:
            logger.warning("No article links found to scrape")
            return []
        
        # Scrape each article
        articles = []
        for url in article_links:
            article = self.scrape_article(url)
            if article:
                articles.append(article.to_dict())
                self.stats["articles_scraped"] += 1
        
        logger.info(f"Scraped {len(articles)} articles")
        return articles
    
    def save_data(self, articles: List[Dict[str, Any]]) -> None:
        """
        Save the scraped articles to files.
        
        Args:
            articles: List of article dictionaries
        """
        if not articles:
            logger.warning("No articles to save")
            return
        
        try:
            # Save all articles as JSON
            data_file = os.path.join(self.output_paths["data"], "articles.json")
            with open(data_file, 'w') as f:
                json.dump(articles, f, indent=2)
            
            # Save individual articles
            articles_dir = os.path.join(self.output_paths["data"], "articles")
            os.makedirs(articles_dir, exist_ok=True)
            
            for i, article in enumerate(articles):
                # Create a filename from the article title
                filename = re.sub(r'[^\w\s-]', '', article["title"])
                filename = re.sub(r'[-\s]+', '-', filename).strip('-').lower()
                
                # Ensure filename is not too long
                if len(filename) > 100:
                    filename = filename[:100]
                
                # Add index in case of duplicate filenames
                article_file = os.path.join(articles_dir, f"{i+1}-{filename}.json")
                with open(article_file, 'w') as f:
                    json.dump(article, f, indent=2)
            
            # Create a CSV export
            export_file = os.path.join(self.output_paths["exports"], "articles.csv")
            with open(export_file, 'w') as f:
                # Write header
                f.write("Title,URL,Author,Published Date,Categories\n")
                
                for article in articles:
                    # Escape commas in fields
                    title = article["title"].replace(",", "\\,")
                    url = article["url"]
                    author = article["author"].replace(",", "\\,")
                    date = article["published_date"] or "Unknown"
                    categories = "|".join(article["categories"]).replace(",", "\\,")
                    
                    f.write(f"{title},{url},{author},{date},{categories}\n")
            
            # Create a plain text export of articles
            text_dir = os.path.join(self.output_paths["exports"], "text")
            os.makedirs(text_dir, exist_ok=True)
            
            for i, article in enumerate(articles):
                # Create a filename from the article title
                filename = re.sub(r'[^\w\s-]', '', article["title"])
                filename = re.sub(r'[-\s]+', '-', filename).strip('-').lower()
                
                # Ensure filename is not too long
                if len(filename) > 100:
                    filename = filename[:100]
                
                # Add index in case of duplicate filenames
                text_file = os.path.join(text_dir, f"{i+1}-{filename}.txt")
                
                with open(text_file, 'w') as f:
                    f.write(f"Title: {article['title']}\n")
                    f.write(f"URL: {article['url']}\n")
                    f.write(f"Author: {article['author']}\n")
                    f.write(f"Published: {article['published_date'] or 'Unknown'}\n")
                    f.write(f"Categories: {', '.join(article['categories'])}\n")
                    f.write("\n\n")
                    
                    # Convert HTML content to plain text
                    h = html2text.HTML2Text()
                    h.ignore_links = False
                    h.ignore_images = True
                    plain_text = h.handle(article['content'])
                    
                    f.write(plain_text)
            
            logger.info(f"Saved {len(articles)} articles to {data_file} and exported to {export_file}")
            
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
            start_time = datetime.datetime.fromisoformat(self.stats["start_time"])
            elapsed = (datetime.datetime.now() - start_time).total_seconds()
        else:
            elapsed = 0
        
        # Update final stats
        self.stats["end_time"] = datetime.datetime.now().isoformat()
        self.stats["elapsed_seconds"] = elapsed
        
        # Save report
        report_file = os.path.join(self.output_paths["data"], "report.json")
        with open(report_file, 'w') as f:
            json.dump(self.stats, f, indent=2)
        
        logger.info(f"Generated scraping report: {report_file}")
        return self.stats


def run(config: Dict[str, Any], output_paths: Dict[str, str]) -> Dict[str, Any]:
    """
    Run the news scraper with the given configuration.
    
    Args:
        config: Configuration dictionary
        output_paths: Dictionary with paths for different output types
        
    Returns:
        Dictionary containing scraping results and statistics
    """
    try:
        # Initialize and run the scraper
        scraper = NewsScraper(config, output_paths)
        articles = scraper.scrape()
        scraper.save_data(articles)
        report = scraper.generate_report()
        
        return {
            "success": True,
            "items_scraped": len(articles),
            "stats": report
        }
        
    except Exception as e:
        logger.error(f"Error running news scraper: {str(e)}")
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
    
    parser = argparse.ArgumentParser(description="News website scraper")
    parser.add_argument("--url", default="https://news.example.com", help="URL to scrape")
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
            "title": "h1.headline",
            "content": "div.article-body",
            "links": "a.article-link",
            "published_date": "time.published-date",
            "author": "span.author-name",
            "categories": "div.categories a"
        },
        "python_specific": {
            "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "verify_ssl": True
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


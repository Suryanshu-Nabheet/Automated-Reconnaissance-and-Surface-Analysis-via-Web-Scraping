#!/usr/bin/env python3
"""
Unified Web Scraping Orchestrator

This script coordinates the execution of both Python and TypeScript scrapers,
manages output directories, handles logging, and generates reports.
"""

import os
import sys
import time
import json
import yaml
import logging
import datetime
import subprocess
import importlib
import concurrent.futures
from pathlib import Path
from typing import Dict, List, Any, Optional, Union, Tuple
import traceback
import shutil

# Configure basic logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("scraper_orchestrator")

# Constants
OUTPUT_DIR_PREFIX = "scraper_output"
OUTPUT_SUBDIRS = ["data", "exports", "logs", "reports", "schemas"]
CONFIG_DIR = os.path.join("src", "config")
DEFAULT_CONFIG_FILE = os.path.join(CONFIG_DIR, "config.yaml")

class ScraperOrchestrator:
    """Main class to orchestrate the web scraping operations."""
    
    def __init__(self, config_path: str = DEFAULT_CONFIG_FILE):
        """
        Initialize the scraper orchestrator.
        
        Args:
            config_path: Path to the configuration file
        """
        self.start_time = datetime.datetime.now()
        self.timestamp = self.start_time.strftime("%Y%m%d_%H%M%S")
        self.output_dir = f"{OUTPUT_DIR_PREFIX}_{self.timestamp}"
        self.config = self._load_config(config_path)
        self.file_logger = None
        self._setup_directories()
        self._setup_file_logging()
        
        # Stats for reporting
        self.stats = {
            "start_time": self.start_time.isoformat(),
            "python_scrapers_run": 0,
            "ts_scrapers_run": 0,
            "successful_scrapers": 0,
            "failed_scrapers": 0,
            "data_items_collected": 0,
            "errors": []
        }
        
        # Check environment
        self._check_environment()
    
    def _load_config(self, config_path: str) -> Dict[str, Any]:
        """
        Load configuration from YAML file.
        
        Args:
            config_path: Path to the configuration file
            
        Returns:
            Dict containing configuration
        """
        try:
            if not os.path.exists(config_path):
                logger.warning(f"Config file {config_path} not found. Creating default config.")
                self._create_default_config(config_path)
            
            with open(config_path, 'r') as f:
                config = yaml.safe_load(f)
            logger.info(f"Loaded configuration from {config_path}")
            return config
        except Exception as e:
            logger.error(f"Failed to load config: {str(e)}")
            logger.info("Using default configuration")
            return self._get_default_config()
    
    def _create_default_config(self, config_path: str) -> None:
        """
        Create a default configuration file if one doesn't exist.
        
        Args:
            config_path: Path where the config file should be created
        """
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, 'w') as f:
            yaml.dump(self._get_default_config(), f)
    
    def _get_default_config(self) -> Dict[str, Any]:
        """
        Get default configuration.
        
        Returns:
            Dict containing default configuration
        """
        return {
            "parallelism": {
                "max_workers": 4,
                "timeout": 300
            },
            "scrapers": {
                "python": ["example_scraper"],
                "typescript": ["example_scraper"]
            },
            "targets": {
                "example": {
                    "url": "https://example.com",
                    "selectors": {
                        "title": "h1",
                        "content": "div.content"
                    }
                }
            },
            "rate_limiting": {
                "requests_per_minute": 10,
                "delay_between_requests": 1.0
            },
            "output": {
                "formats": ["json", "csv"]
            }
        }
    
    def _setup_directories(self) -> None:
        """Create the output directory structure."""
        try:
            # Create main output directory
            os.makedirs(self.output_dir, exist_ok=True)
            
            # Create subdirectories
            for subdir in OUTPUT_SUBDIRS:
                os.makedirs(os.path.join(self.output_dir, subdir), exist_ok=True)
            
            logger.info(f"Created output directory structure at {self.output_dir}")
        except Exception as e:
            logger.error(f"Failed to create directories: {str(e)}")
            raise
    
    def _setup_file_logging(self) -> None:
        """Set up logging to a file."""
        log_file = os.path.join(self.output_dir, "logs", "orchestrator.log")
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        ))
        logger.addHandler(file_handler)
        
        # Create a separate logger for scrapers
        self.file_logger = logging.getLogger("scraper_file_logger")
        self.file_logger.setLevel(logging.DEBUG)
        self.file_logger.addHandler(file_handler)
        
        logger.info(f"Logging to {log_file}")
    
    def _check_environment(self) -> None:
        """
        Check if the required dependencies are installed.
        """
        logger.info("Checking Python environment...")
        try:
            # Check Python dependencies
            required_modules = ["requests", "beautifulsoup4", "pandas", "yaml"]
            for module in required_modules:
                try:
                    importlib.import_module(module)
                except ImportError:
                    logger.warning(f"Python module {module} not found. Installing...")
                    subprocess.check_call([sys.executable, "-m", "pip", "install", module])
            
            logger.info("Python environment OK")
            
            # Check Node.js and npm
            logger.info("Checking Node.js environment...")
            try:
                node_version = subprocess.check_output(["node", "--version"]).decode().strip()
                npm_version = subprocess.check_output(["npm", "--version"]).decode().strip()
                logger.info(f"Node.js version: {node_version}, npm version: {npm_version}")
                
                # Check if TypeScript dependencies are installed
                if not os.path.exists("node_modules"):
                    logger.warning("Node modules not found. Installing dependencies...")
                    subprocess.check_call(["npm", "install"])
                
                logger.info("Node.js environment OK")
            except (subprocess.SubprocessError, FileNotFoundError) as e:
                logger.error(f"Node.js environment check failed: {str(e)}")
                logger.warning("TypeScript scrapers may not work correctly")
        except Exception as e:
            logger.error(f"Environment check failed: {str(e)}")
    
    def run_python_scraper(self, scraper_name: str) -> Tuple[bool, Dict[str, Any]]:
        """
        Run a Python scraper module.
        
        Args:
            scraper_name: Name of the scraper module
            
        Returns:
            Tuple of (success, result_data)
        """
        logger.info(f"Running Python scraper: {scraper_name}")
        scraper_stats = {
            "name": scraper_name,
            "type": "python",
            "start_time": datetime.datetime.now().isoformat(),
            "status": "failed",
            "items_scraped": 0,
            "error": None
        }
        
        try:
            # Import the scraper module
            scraper_module = importlib.import_module(f"src.scrapers.python.{scraper_name}")
            
            # Prepare scraper config
            scraper_config = self.config.get("targets", {}).get(scraper_name, {})
            output_paths = {
                "data": os.path.join(self.output_dir, "data", f"{scraper_name}"),
                "exports": os.path.join(self.output_dir, "exports", f"{scraper_name}"),
                "schemas": os.path.join(self.output_dir, "schemas", f"{scraper_name}")
            }
            
            # Create scraper-specific directories
            for path in output_paths.values():
                os.makedirs(path, exist_ok=True)
            
            # Run the scraper
            result = scraper_module.run(scraper_config, output_paths)
            
            # Update stats
            scraper_stats["status"] = "success"
            scraper_stats["items_scraped"] = result.get("items_scraped", 0)
            scraper_stats["end_time"] = datetime.datetime.now().isoformat()
            
            logger.info(f"Python scraper {scraper_name} completed successfully")
            return True, scraper_stats
        except Exception as e:
            error_msg = f"Python scraper {scraper_name} failed: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            
            # Update stats
            scraper_stats["status"] = "failed"
            scraper_stats["error"] = str(e)
            scraper_stats["traceback"] = traceback.format_exc()
            scraper_stats["end_time"] = datetime.datetime.now().isoformat()
            
            return False, scraper_stats
    
    def run_typescript_scraper(self, scraper_name: str) -> Tuple[bool, Dict[str, Any]]:
        """
        Run a TypeScript scraper.
        
        Args:
            scraper_name: Name of the TypeScript scraper
            
        Returns:
            Tuple of (success, result_data)
        """
        logger.info(f"Running TypeScript scraper: {scraper_name}")
        scraper_stats = {
            "name": scraper_name,
            "type": "typescript",
            "start_time": datetime.datetime.now().isoformat(),
            "status": "failed",
            "items_scraped": 0,
            "error": None
        }
        
        try:
            # Ensure TypeScript is compiled
            logger.info("Compiling TypeScript code...")
            subprocess.check_call(["npm", "run", "build"])
            
            # Prepare paths and arguments
            output_base = os.path.join(self.output_dir)
            config_path = os.path.join("src", "config", f"{scraper_name}.json")
            
            # Create scraper-specific config if it doesn't exist
            if not os.path.exists(config_path):
                scraper_config = self.config.get("targets", {}).get(scraper_name, {})
                os.makedirs(os.path.dirname(config_path), exist_ok=True)
                with open(config_path, 'w') as f:
                    json.dump(scraper_config, f, indent=2)
            
            # Create scraper-specific directories
            for subdir in ["data", "exports", "schemas"]:
                os.makedirs(os.path.join(self.output_dir, subdir, scraper_name), exist_ok=True)
            
            # Run the TypeScript scraper using Node.js
            cmd = [
                "node",
                "-r", "ts-node/register",
                os.path.join("src", "scrapers", "ts", f"{scraper_name}.ts"),
                "--config", config_path,
                "--output", output_base
            ]
            
            logger.info(f"Running command: {' '.join(cmd)}")
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True
            )
            
            # Capture output
            stdout, stderr = process.communicate()
            
            # Log the output
            if stdout:
                logger.info(f"TypeScript scraper output: {stdout}")
            if stderr:
                logger.warning(f"TypeScript scraper stderr: {stderr}")
            
            # Check if successful
            if process.returncode == 0:
                # Try to parse the result from the output
                try:
                    result_file = os.path.join(self.output_dir, "data", scraper_name, "result.json")
                    if os.path.exists(result_file):
                        with open(result_file, 'r') as f:
                            result = json.load(f)
                            scraper_stats["items_scraped"] = result.get("items_scraped", 0)
                except Exception as e:
                    logger.warning(f"Could not parse result stats: {str(e)}")
                    scraper_stats["items_scraped"] = 0
                
                scraper_stats["status"] = "success"
                scraper_stats["end_time"] = datetime.datetime.now().isoformat()
                logger.info(f"TypeScript scraper {scraper_name} completed successfully")
                return True, scraper_stats
            else:
                error_msg = f"TypeScript scraper {scraper_name} failed with code {process.returncode}"
                logger.error(error_msg)
                
                # Update stats
                scraper_stats["status"] = "failed"
                scraper_stats["error"] = error_msg
                scraper_stats["stderr"] = stderr
                scraper_stats["end_time"] = datetime.datetime.now().isoformat()
                
                return False, scraper_stats
        except Exception as e:
            error_msg = f"TypeScript scraper {scraper_name} failed: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            
            # Update stats
            scraper_stats["status"] = "failed"
            scraper_stats["error"] = str(e)
            scraper_stats["traceback"] = traceback.format_exc()
            scraper_stats["end_time"] = datetime.datetime.now().isoformat()
            
            return False, scraper_stats
    
    def run_scrapers(self) -> None:
        """Run all configured scrapers in parallel."""
        python_scrapers = self.config.get("scrapers", {}).get("python", [])
        ts_scrapers = self.config.get("scrapers", {}).get("typescript", [])
        
        max_workers = self.config.get("parallelism", {}).get("max_workers", 4)
        scraper_timeout = self.config.get("parallelism", {}).get("timeout", 300)
        
        logger.info(f"Starting scraper execution with {max_workers} workers")
        logger.info(f"Python scrapers: {', '.join(python_scrapers) if python_scrapers else 'None'}")
        logger.info(f"TypeScript scrapers: {', '.join(ts_scrapers) if ts_scrapers else 'None'}")
        
        all_results = []
        
        # Run scrapers in parallel
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit Python scrapers
            python_futures = {
                executor.submit(self.run_python_scraper, scraper): ("python", scraper)
                for scraper in python_scrapers
            }
            
            # Submit TypeScript scrapers
            ts_futures = {
                executor.submit(self.run_typescript_scraper, scraper): ("typescript", scraper)
                for scraper in ts_scrapers
            }
            
            # Combine all futures
            all_futures = {**python_futures, **ts_futures}
            
            # Process results as they complete
            for future in concurrent.futures.as_completed(all_futures, timeout=scraper_timeout):
                scraper_type, scraper_name = all_futures[future]
                try:
                    success, result = future.result()
                    all_results.append(result)
                    
                    if success:
                        self.stats["successful_scrapers"] += 1
                        self.stats["data_items_collected"] += result.get("items_scraped", 0)
                    else:
                        self.stats["failed_scrapers"] += 1
                        self.stats["errors"].append({
                            "scraper": scraper_name,
                            "type": scraper_type,
                            "error": result.get("error", "Unknown error")
                        })
                    
                    if scraper_type == "python":
                        self.stats["python_scrapers_run"] += 1
                    else:
                        self.stats["ts_scrapers_run"] += 1
                
                except Exception as e:
                    logger.error(f"Error processing {scraper_type} scraper {scraper_name}: {str(e)}")
                    self.stats["failed_scrapers"] += 1
                    self.stats["errors"].append({
                        "scraper": scraper_name,
                        "type": scraper_type,
                        "error": str(e)
                    })
        
        # Generate report with all results
        self._generate_report(all_results)
    
    def _generate_report(self, scraper_results: List[Dict[str, Any]]) -> None:
        """
        Generate a report of the scraping run.
        
        Args:
            scraper_results: List of results from all scrapers
        """
        logger.info("Generating report...")
        
        end_time = datetime.datetime.now()
        duration = (end_time - self.start_time).total_seconds()
        
        # Add final stats
        self.stats["end_time"] = end_time.isoformat()
        self.stats["duration_seconds"] = duration
        self.stats["scraper_results"] = scraper_results
        
        # Create summary report
        report = {
            "summary": {
                "start_time": self.stats["start_time"],
                "end_time": self.stats["end_time"],
                "duration_seconds": self.stats["duration_seconds"],
                "python_scrapers_run": self.stats["python_scrapers_run"],
                "ts_scrapers_run": self.stats["ts_scrapers_run"],
                "successful_scrapers": self.stats["successful_scrapers"],
                "failed_scrapers": self.stats["failed_scrapers"],
                "data_items_collected": self.stats["data_items_collected"],
                "output_directory": self.output_dir
            },
            "errors": self.stats["errors"],
            "scraper_details": scraper_results
        }
        
        # Save detailed report as JSON
        report_file = os.path.join(self.output_dir, "reports", "scraping_report.json")
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        # Create a simple HTML report
        self._generate_html_report(report)
        
        logger.info(f"Report generated at {report_file}")
        logger.info(f"Scraping completed: {self.stats['successful_scrapers']} successful, "
                   f"{self.stats['failed_scrapers']} failed, "
                   f"{self.stats['data_items_collected']} items collected")
    
    def _generate_html_report(self, report_data: Dict[str, Any]) -> None:
        """
        Generate an HTML report.
        
        Args:
            report_data: Report data dictionary
        """
        html_file = os.path.join(self.output_dir, "reports", "scraping_report.html")
        
        # Simple HTML template
        html_content = f"""<!DOCTYPE html>
<html>
<head>
    <title>Web Scraping Report - {self.timestamp}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; }}
        h1, h2 {{ color: #333; }}
        .summary {{ background-color: #f5f5f5; padding: 15px; border-radius: 5px; }}
        .success {{ color: green; }}
        .error {{ color: red; }}
        table {{ border-collapse: collapse; width: 100%; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background-color: #f2f2f2; }}
        tr:nth-child(even) {{ background-color: #f9f9f9; }}
    </style>
</head>
<body>
    <h1>Web Scraping Report</h1>
    
    <div class="summary">
        <h2>Summary</h2>
        <p><strong>Start Time:</strong> {report_data['summary']['start_time']}</p>
        <p><strong>End Time:</strong> {report_data['summary']['end_time']}</p>
        <p><strong>Duration:</strong> {report_data['summary']['duration_seconds']:.2f} seconds</p>
        <p><strong>Python Scrapers Run:</strong> {report_data['summary']['python_scrapers_run']}</p>
        <p><strong>TypeScript Scrapers Run:</strong> {report_data['summary']['ts_scrapers_run']}</p>
        <p><strong>Successful Scrapers:</strong> <span class="success">{report_data['summary']['successful_scrapers']}</span></p>
        <p><strong>Failed Scrapers:</strong> <span class="error">{report_data['summary']['failed_scrapers']}</span></p>
        <p><strong>Data Items Collected:</strong> {report_data['summary']['data_items_collected']}</p>
        <p><strong>Output Directory:</strong> {report_data['summary']['output_directory']}</p>
    </div>
    
    <h2>Scraper Details</h2>
    <table>
        <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Items Scraped</th>
            <th>Start Time</th>
            <th>End Time</th>
        </tr>
        {"".join([f'''
        <tr>
            <td>{result['name']}</td>
            <td>{result['type']}</td>
            <td class="{'success' if result['status'] == 'success' else 'error'}">{result['status']}</td>
            <td>{result.get('items_scraped', 0)}</td>
            <td>{result['start_time']}</td>
            <td>{result.get('end_time', '')}</td>
        </tr>
        ''' for result in report_data['scraper_details']])}
    </table>
    
    {f'''
    <h2>Errors</h2>
    <table>
        <tr>
            <th>Scraper</th>
            <th>Type</th>
            <th>Error</th>
        </tr>
        {"".join([f'''
        <tr>
            <td>{error['scraper']}</td>
            <td>{error['type']}</td>
            <td class="error">{error['error']}</td>
        </tr>
        ''' for error in report_data['errors']])}
    </table>
    ''' if report_data['errors'] else ''}
    
    <p><em>Report generated on {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</em></p>
</body>
</html>
"""
        
        with open(html_file, 'w') as f:
            f.write(html_content)
        
        logger.info(f"HTML report generated at {html_file}")


def main():
    """Main entry point."""
    try:
        # Create and run the orchestrator
        orchestrator = ScraperOrchestrator()
        orchestrator.run_scrapers()
        
        print(f"\nScraping completed successfully!")
        print(f"Output directory: {orchestrator.output_dir}")
        print(f"Check the reports directory for detailed results.")
        
        return 0
    except KeyboardInterrupt:
        print("\nScraping interrupted by user.")
        return 1
    except Exception as e:
        print(f"\nScraping failed: {str(e)}")
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())


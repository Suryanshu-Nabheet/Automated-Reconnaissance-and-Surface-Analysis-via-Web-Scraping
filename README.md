# Unified Web Scraping Framework

A comprehensive web scraping framework that combines the power of Python and TypeScript in a single, unified system. This framework allows you to leverage the strengths of both ecosystems to build robust, scalable web scrapers for a wide range of websites.

## 🌟 Features

- **Hybrid Architecture**: Combines Python and TypeScript in a unified framework
- **Parallel Execution**: Run multiple scrapers simultaneously for improved performance
- **Browser Automation**: Full browser automation using Puppeteer (TypeScript) and integration options for Selenium (Python)
- **Headless Scraping**: Support for both headless and non-headless browser scraping
- **Data Validation**: Schema-based validation for scraped data
- **Comprehensive Logging**: Detailed logs for debugging and monitoring
- **Configurable Output**: Export data in multiple formats (JSON, CSV, etc.)
- **Rate Limiting**: Built-in protection against being blocked by target websites
- **Error Handling**: Robust error handling and recovery mechanisms
- **Detailed Reporting**: Comprehensive scraping statistics and reports

## 📂 Directory Structure

```
.
├── src/                            # Source code directory
│   ├── scrapers/                   # Scraper implementations
│   │   ├── python/                 # Python scrapers
│   │   │   └── example_scraper.py  # Example Python scraper
│   │   └── ts/                     # TypeScript scrapers
│   │       └── example_scraper.ts  # Example TypeScript scraper
│   ├── utils/                      # Shared utility functions
│   ├── types/                      # TypeScript type definitions
│   └── config/                     # Configuration files
│       └── config.yaml             # Main configuration
├── main.py                         # Main entry point
├── package.json                    # Node.js dependencies
├── tsconfig.json                   # TypeScript configuration
├── requirements.txt                # Python dependencies
└── README.md                       # Project documentation
```

## 🚀 Installation

The framework requires both Python and Node.js environments to be set up.

### Prerequisites

- Python 3.8+ 
- Node.js 14+ and npm
- Git (for cloning the repository)

### Setting Up Python Environment

```bash
# Clone the repository
git clone https://github.com/Suryanshu-Nabheet/Automated-Reconnaissance-and-Surface-Analysis-via-Web-Scraping.git

# Create and activate virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows, use: venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
```

### Setting Up Node.js Environment

```bash
# Install Node.js dependencies
npm install
```

## 🔧 Usage

The framework can be used through the main Python script, which orchestrates both Python and TypeScript scrapers.

### Basic Usage

```bash
# Run all scrapers defined in the configuration
python main.py

# Run with a specific configuration file
python main.py --config path/to/custom_config.yaml

# Run for a specific website only
python main.py --target example_site
```

### Running Individual Scrapers

#### Python Scrapers

```bash
# Run a specific Python scraper directly
python -m src.scrapers.python.example_scraper --url https://example.com --output ./output
```

#### TypeScript Scrapers

```bash
# Run a specific TypeScript scraper directly
npx ts-node src/scrapers/ts/example_scraper.ts --url https://example.com --output ./output
```

## ⚙️ Configuration

The framework uses YAML configuration files to define scraping targets, selectors, and options.

### Main Configuration File

The main configuration file is located at `src/config/config.yaml`. It defines:

- Which scrapers to run
- Target websites and selectors
- Rate limiting and timeout settings
- Output formats and directories
- Proxy and authentication settings

### Example Configuration

```yaml
# List of scrapers to run by type
scrapers:
  python:
    - example_scraper
  typescript:
    - example_scraper

# Target website configurations
targets:
  example_scraper:
    url: https://example.com
    selectors:
      title: h1
      content: div.content
      links: a
    options:
      maxLinks: 5
      delay: 1000
      timeout: 30000
```

### Scraper-Specific Configuration

Each scraper can have its own configuration file in `src/config/` directory, named after the scraper (e.g., `example_scraper.json` or `example_scraper.yaml`).

## 📊 Output Structure

Each scraping run creates a timestamped output directory with the following structure:

```
scraper_output_YYYYMMDD_HHMMSS/
├── data/                  # Raw scraped data
│   ├── example_scraper/   # Data from specific scraper
│   │   ├── items.json     # All scraped items
│   │   ├── items/         # Individual item files
│   │   └── report.json    # Scraping statistics
├── exports/               # Processed/transformed data
│   └── example_scraper/   # Exports from specific scraper
├── logs/                  # Execution logs
│   └── orchestrator.log   # Main log file
├── reports/               # Summary reports
│   ├── scraping_report.json  # Detailed JSON report
│   └── scraping_report.html  # HTML report for viewing
└── schemas/               # Data schemas and models
    └── example_scraper/   # Schema for specific scraper
```

## 🛠 Development

### Adding a New Python Scraper

1. Create a new Python file in `src/scrapers/python/` directory
2. Implement the required `run(config, output_paths)` function
3. Add the scraper to the `scrapers.python` list in `src/config/config.yaml`
4. Add target-specific configuration in the `targets` section of the config file

Example structure:

```python
def run(config, output_paths):
    # Initialize scraper
    # Fetch data
    # Process data
    # Save data
    return {
        "success": True,
        "items_scraped": 10,
        "stats": { ... }
    }
```

### Adding a New TypeScript Scraper

1. Create a new TypeScript file in `src/scrapers/ts/` directory
2. Implement the required interfaces and the `run` function
3. Add the scraper to the `scrapers.typescript` list in `src/config/config.yaml`
4. Add target-specific configuration in the `targets` section of the config file

Example structure:

```typescript
import { ScraperConfig, OutputPaths, ScraperResult } from './types';

export async function run(config: ScraperConfig, outputPaths: OutputPaths): Promise<ScraperResult> {
    // Initialize scraper
    // Fetch data
    // Process data
    // Save data
    return {
        success: true,
        items_scraped: 10,
        stats: { ... }
    };
}
```

## 📝 Best Practices

- **Respect Website Terms**: Always check a website's terms of service and robots.txt before scraping
- **Rate Limiting**: Use appropriate delays between requests to avoid overloading servers
- **User Agents**: Set realistic user agents for your requests
- **Error Handling**: Always implement proper error handling in your scrapers
- **Data Validation**: Validate all scraped data against schemas
- **Logging**: Use detailed logging for debugging purposes
- **Proxy Rotation**: For larger scraping jobs, consider implementing proxy rotation

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request


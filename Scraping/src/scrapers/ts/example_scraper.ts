/**
 * Example TypeScript Scraper
 * 
 * This module demonstrates a simple web scraper using Puppeteer.
 * It extracts basic information from a website and stores it in JSON format.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as winston from 'winston';
import { z } from 'zod';
import * as yaml from 'yaml';

// Setup command line arguments parsing
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/**
 * Configuration interface for the scraper
 */
interface ScraperConfig {
  url: string;
  selectors: {
    title: string;
    content: string;
    links: string;
    metadata?: string;
  };
  options?: {
    maxLinks?: number;
    delay?: number;
    timeout?: number;
    headless?: boolean;
  };
}

/**
 * Output paths interface
 */
interface OutputPaths {
  data: string;
  exports: string;
  schemas: string;
}

/**
 * Interface for scraped items
 */
interface ScrapedItem {
  title: string;
  url: string;
  description: string;
  timestamp: string;
  tags: string[];
  metadata: {
    source: string;
    author: string;
    published_date: string;
  };
}

/**
 * Interface for scraper statistics
 */
interface ScraperStats {
  start_time: string;
  end_time?: string;
  elapsed_seconds?: number;
  pages_visited: number;
  items_scraped: number;
  errors: number;
  bytes_downloaded: number;
}

/**
 * Interface for scraper results
 */
interface ScraperResult {
  success: boolean;
  items_scraped: number;
  stats: ScraperStats;
  error?: string;
}

/**
 * Schema validation for scraped items using Zod
 */
const ScrapedItemSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  description: z.string(),
  timestamp: z.string().datetime(),
  tags: z.array(z.string()),
  metadata: z.object({
    source: z.string(),
    author: z.string(),
    published_date: z.string()
  })
});

/**
 * Setup logging
 */
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} - ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

/**
 * Example scraper class
 */
class ExampleScraper {
  private config: ScraperConfig;
  private outputPaths: OutputPaths;
  private stats: ScraperStats;
  private browser: puppeteer.Browser | null = null;

  /**
   * Constructor
   * @param config Scraper configuration
   * @param outputPaths Output directory paths
   */
  constructor(config: ScraperConfig, outputPaths: OutputPaths) {
    this.config = config;
    this.outputPaths = outputPaths;
    this.stats = {
      start_time: new Date().toISOString(),
      pages_visited: 0,
      items_scraped: 0,
      errors: 0,
      bytes_downloaded: 0
    };

    // Create output directories if they don't exist
    Object.values(outputPaths).forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Save the schema definition
    const schemaPath = path.join(outputPaths.schemas, 'schema.json');
    fs.writeFileSync(
      schemaPath, 
      JSON.stringify({
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string", format: "uri" },
          description: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
          tags: {
            type: "array",
            items: { type: "string" }
          },
          metadata: {
            type: "object",
            properties: {
              source: { type: "string" },
              author: { type: "string" },
              published_date: { type: "string" }
            }
          }
        },
        required: ["title", "url", "timestamp"]
      }, null, 2)
    );

    logger.info(`Initialized example scraper with target URL: ${this.config.url || 'Not specified'}`);
  }

  /**
   * Main scrape method using Puppeteer
   * @returns Promise resolving to an array of scraped items
   */
  async scrapeWithPuppeteer(): Promise<ScrapedItem[]> {
    const targetUrl = this.config.url || 'https://example.com';
    const selectors = this.config.selectors;
    const options = this.config.options || {};
    
    logger.info(`Starting Puppeteer scrape of ${targetUrl}`);
    
    try {
      // Launch browser
      this.browser = await puppeteer.launch({
        headless: options.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      // Open new page
      const page = await this.browser.newPage();
      
      // Set default timeout
      page.setDefaultTimeout(options.timeout || 30000);
      
      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Go to URL
      await page.goto(targetUrl, { waitUntil: 'networkidle2' });
      
      // Update stats
      this.stats.pages_visited++;
      
      // Get page content size
      const content = await page.content();
      this.stats.bytes_downloaded += content.length;
      
      logger.info(`Successfully loaded ${targetUrl}`);
      
      // Extract data using page.evaluate
      const extractedData = await page.evaluate((selectors) => {
        const extractText = (selector: string) => {
          const element = document.querySelector(selector);
          return element ? element.textContent?.trim() || '' : '';
        };
        
        const title = extractText(selectors.title);
        const content = extractText(selectors.content);
        
        // Extract links
        const links: Array<{ url: string, text: string }> = [];
        const linkElements = document.querySelectorAll(selectors.links);
        linkElements.forEach((link) => {
          const href = link.getAttribute('href');
          if (href && !href.startsWith('#')) {
            links.push({
              url: href.startsWith('http') ? href : new URL(href, window.location.origin).toString(),
              text: link.textContent?.trim() || ''
            });
          }
        });
        
        return { title, content, links };
      }, selectors);
      
      // Create items
      const items: ScrapedItem[] = [];
      
      // Add main item
      const mainItem: ScrapedItem = {
        title: extractedData.title || 'No Title Found',
        url: targetUrl,
        description: extractedData.content ? 
          (extractedData.content.length > 200 ? extractedData.content.slice(0, 200) + '...' : extractedData.content) :
          'No Content Found',
        timestamp: new Date().toISOString(),
        tags: ['example', 'typescript', 'puppeteer'],
        metadata: {
          source: 'example_ts_scraper',
          author: 'Automated TS Scraper',
          published_date: new Date().toISOString().split('T')[0]
        }
      };
      
      items.push(mainItem);
      
      // Add link items
      const maxLinks = options.maxLinks || 5;
      extractedData.links.slice(0, maxLinks).forEach(link => {
        const item: ScrapedItem = {
          title: link.text || 'Link without text',
          url: link.url,
          description: `Link found on ${targetUrl}`,
          timestamp: new Date().toISOString(),
          tags: ['link', 'reference', 'typescript'],
          metadata: {
            source: 'example_ts_scraper',
            author: 'Unknown',
            published_date: new Date().toISOString().split('T')[0]
          }
        };
        items.push(item);
      });
      
      // Add random delay to simulate processing
      const delay = options.delay || Math.random() * 1500 + 500;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Update stats
      this.stats.items_scraped += items.length;
      logger.info(`Extracted ${items.length} items from ${targetUrl}`);
      
      return items;
    } catch (error) {
      this.stats.errors++;
      logger.error(`Puppeteer scraping error: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        logger.error(`Stack trace: ${error.stack}`);
      }
      return [];
    } finally {
      // Close browser
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    }
  }

  /**
   * Alternative scrape method using Axios and Cheerio
   * @returns Promise resolving to an array of scraped items
   */
  async scrapeWithCheerio(): Promise<ScrapedItem[]> {
    const targetUrl = this.config.url || 'https://example.com';
    const selectors = this.config.selectors;
    const options = this.config.options || {};
    
    logger.info(`Starting Cheerio scrape of ${targetUrl}`);
    
    try {
      // Fetch page content
      const response = await axios.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        timeout: options.timeout || 30000
      });
      
      // Update stats
      this.stats.pages_visited++;
      this.stats.bytes_downloaded += response.data.length;
      
      // Load HTML with Cheerio
      const $ = cheerio.load(response.data);
      logger.info(`Successfully downloaded and parsed ${targetUrl}`);
      
      // Extract data
      const title = $(selectors.title).text().trim() || 'No Title Found';
      const content = $(selectors.content).text().trim() || 'No Content Found';
      
      // Extract links
      const links: Array<{ url: string, text: string }> = [];
      $(selectors.links).each((_, element) => {
        const href = $(element).attr('href');
        if (href && !href.startsWith('#')) {
          links.push({
            url: href.startsWith('http') ? href : new URL(href, targetUrl).toString(),
            text: $(element).text().trim()
          });
        }
      });
      
      // Create items
      const items: ScrapedItem[] = [];
      
      // Add main item
      const mainItem: ScrapedItem = {
        title,
        url: targetUrl,
        description: content.length > 200 ? content.slice(0, 200) + '...' : content,
        timestamp: new Date().toISOString(),
        tags: ['example', 'typescript', 'cheerio'],
        metadata: {
          source: 'example_ts_scraper',
          author: 'Automated TS Scraper',
          published_date: new Date().toISOString().split('T')[0]
        }
      };
      
      items.push(mainItem);
      
      // Add link items
      const maxLinks = options.maxLinks || 5;
      links.slice(0, maxLinks).forEach(link => {
        const item: ScrapedItem = {
          title: link.text || 'Link without text',
          url: link.url,
          description: `Link found on ${targetUrl}`,
          timestamp: new Date().toISOString(),
          tags: ['link', 'reference', 'typescript'],
          metadata: {
            source: 'example_ts_scraper',
            author: 'Unknown',
            published_date: new Date().toISOString().split('T')[0]
          }
        };
        items.push(item);
      });
      
      // Simulate processing time
      const delay = options.delay || Math.random() * 1500 + 500;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Update stats
      this.stats.items_scraped += items.length;
      logger.info(`Extracted ${items.length} items from ${targetUrl}`);
      
      return items;
    } catch (error) {
      this.stats.errors++;
      logger.error(`Cheerio scraping error: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        logger.error(`Stack trace: ${error.stack}`);
      }
      return [];
    }
  }

  /**
   * Save scraped data to files
   * @param items Array of scraped items
   */
  async saveData(items: ScrapedItem[]): Promise<void> {
    if (!items.length) {
      logger.warn('No items to save');
      return;
    }
    
    try {
      // Validate items against schema
      for (const item of items) {
        try {
          ScrapedItemSchema.parse(item);
        } catch (error) {
          logger.warn(`Item validation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Save as JSON
      const dataFile = path.join(this.outputPaths.data, 'items.json');
      fs.writeFileSync(dataFile, JSON.stringify(items, null, 2));
      
      // Save individual items
      const itemsDir = path.join(this.outputPaths.data, 'items');
      if (!fs.existsSync(itemsDir)) {
        fs.mkdirSync(itemsDir, { recursive: true });
      }
      
      items.forEach((item, index) => {
        const itemFile = path.join(itemsDir, `item_${index + 1}.json`);
        fs.writeFileSync(itemFile, JSON.stringify(item, null, 2));
      });
      
      // Create a simple export in different format (CSV-like)
      const exportFile = path.join(this.outputPaths.exports, 'items_export.csv');
      const csvContent = [
        'Title,URL,Description',
        ...items.map(item => {
          // Escape commas in fields
          const title = item.title.replace(/,/g, '\\,');
          const url = item.url;
          const description = item.description.replace(/,/g, '\\,');
          return `${title},${url},${description}`;
        })
      ].join('\n');
      
      fs.writeFileSync(exportFile, csvContent);
      
      logger.info(`Saved ${items.length} items to ${dataFile} and exported to ${exportFile}`);
    } catch (error) {
      this.stats.errors++;
      logger.error(`Error saving data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a report of the scraping process
   * @returns Scraper statistics
   */
  generateReport(): ScraperStats {
    // Calculate elapsed time
    const startTime = new Date(this.stats.start_time);
    const endTime = new Date();
    const elapsed = (endTime.getTime() - startTime.getTime()) / 1000;
    
    // Update final stats
    this.stats.end_time = endTime.toISOString();
    this.stats.elapsed_seconds = elapsed;
    
    // Save report
    const reportFile = path.join(this.outputPaths.data, 'report.json');
    fs.writeFileSync(reportFile, JSON.stringify(this.stats, null, 2));
    
    logger.info(`Generated scraping report: ${reportFile}`);
    return this.stats;
  }
}

/**
 * Main function to run the scraper
 * @param config Scraper configuration
 * @param outputPaths Output directory paths
 * @returns Promise resolving to scraper results
 */
async function run(config: ScraperConfig, outputPaths: OutputPaths): Promise<ScraperResult> {
  try {
    // Initialize and run the scraper
    const scraper = new ExampleScraper(config, outputPaths);
    
    // Choose scraping method - Puppeteer for more complex sites, Cheerio for simpler ones
    // For demonstration, we'll use Puppeteer by default
    const usePuppeteer = config.options?.headless !== undefined;
    const items = usePuppeteer ? 
      await scraper.scrapeWithPuppeteer() : 
      await scraper.scrapeWithCheerio();
    
    await scraper.saveData(items);
    const stats = scraper.generateReport();
    
    return {
      success: true,
      items_scraped: items.length,
      stats: stats
    };
  } catch (error) {
    logger.error(`Error running scraper: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logger.error(`Stack trace: ${error.stack}`);
    }
    
    return {
      success: false,
      items_scraped: 0,
      stats: {
        start_time: new Date().toISOString(),
        pages_visited: 0,
        items_scraped: 0,
        errors: 1,
        bytes_downloaded: 0
      },
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Command-line entry point
 */
async function main() {
  // Parse command line arguments
  const argv = yargs(hideBin(process.argv))
    .option('config', {
      alias: 'c',
      type: 'string',
      description: 'Path to configuration file'
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output directory',
      default: './output'
    })
    .option('url', {
      alias: 'u',
      type: 'string',
      description: 'URL to scrape',
      default: 'https://example.com'
    })
    .help()
    .alias('help', 'h')
    .parseSync();

  try {
    // Load config from file or use defaults
    let config: ScraperConfig;
    
    if (argv.config && typeof argv.config === 'string' && fs.existsSync(argv.config)) {
      const configContent = fs.readFileSync(argv.config, 'utf8');
      const ext = path.extname(argv.config).toLowerCase();
      
      if (ext === '.json') {
        config = JSON.parse(configContent);
      } else if (ext === '.yaml' || ext === '.yml') {
        config = yaml.parse(configContent);
      } else {
        throw new Error(`Unsupported config file format: ${ext}`);
      }
    } else {
      // Use default configuration
      config = {
        url: typeof argv.url === 'string' ? argv.url : 'https://example.com',
        selectors: {
          title: 'h1',
          content: 'div',
          links: 'a'
        },
        options: {
          maxLinks: 5,
          delay: 1000,
          timeout: 30000,
          headless: true
        }
      };
    }
    
    // Create output paths
    const outputBase = typeof argv.output === 'string' ? argv.output : './output';
    const outputPaths: OutputPaths = {
      data: path.join(outputBase, 'data'),
      exports: path.join(outputBase, 'exports'),
      schemas: path.join(outputBase, 'schemas')
    };
    
    // Run the scraper
    logger.info('Starting TypeScript scraper...');
    const result = await run(config, outputPaths);
    
    // Output result
    console.log(JSON.stringify(result, null, 2));
    
    // Return success status
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run the main function if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

// Export the run function for importing in other modules
export { run, ScraperConfig, OutputPaths, ScraperResult };


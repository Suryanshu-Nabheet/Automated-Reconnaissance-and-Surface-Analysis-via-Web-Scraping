"use strict";
/**
 * Product Scraper
 *
 * This module implements a product scraper for e-commerce websites.
 * It extracts product information including prices, variants, and image galleries.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const puppeteer = __importStar(require("puppeteer"));
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const winston = __importStar(require("winston"));
const zod_1 = require("zod");
const yaml = __importStar(require("yaml"));
// Setup command line arguments parsing
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
/**
 * Schema validation for scraped products using Zod
 */
const ProductPriceSchema = zod_1.z.object({
    amount: zod_1.z.number(),
    currency: zod_1.z.string(),
    formatted: zod_1.z.string(),
    discounted: zod_1.z.boolean(),
    originalAmount: zod_1.z.number().optional(),
    originalFormatted: zod_1.z.string().optional(),
    discountPercentage: zod_1.z.number().optional()
});
const ProductImageSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    alt: zod_1.z.string(),
    isMain: zod_1.z.boolean(),
    thumbnailUrl: zod_1.z.string().url().optional(),
    position: zod_1.z.number()
});
const ProductVariantSchema = zod_1.z.object({
    name: zod_1.z.string(),
    value: zod_1.z.string(),
    price: zod_1.z.string().optional(),
    currency: zod_1.z.string().optional(),
    available: zod_1.z.boolean(),
    sku: zod_1.z.string().optional()
});
const ProductReviewSchema = zod_1.z.object({
    author: zod_1.z.string(),
    rating: zod_1.z.number().min(0).max(5),
    date: zod_1.z.string(),
    title: zod_1.z.string().optional(),
    text: zod_1.z.string(),
    helpful: zod_1.z.number().optional()
});
const ScrapedProductSchema = zod_1.z.object({
    title: zod_1.z.string(),
    url: zod_1.z.string().url(),
    sku: zod_1.z.string(),
    description: zod_1.z.string(),
    shortDescription: zod_1.z.string().optional(),
    price: ProductPriceSchema,
    images: zod_1.z.array(ProductImageSchema),
    variants: zod_1.z.array(ProductVariantSchema),
    reviews: zod_1.z.array(ProductReviewSchema),
    rating: zod_1.z.object({
        average: zod_1.z.number().min(0).max(5),
        count: zod_1.z.number().min(0),
        distribution: zod_1.z.record(zod_1.z.string(), zod_1.z.number()).optional()
    }),
    metadata: zod_1.z.object({
        brand: zod_1.z.string().optional(),
        category: zod_1.z.string().optional(),
        inStock: zod_1.z.boolean(),
        stockLevel: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
        shippingInfo: zod_1.z.string().optional(),
        tags: zod_1.z.array(zod_1.z.string())
    }),
    relatedProducts: zod_1.z.array(zod_1.z.object({
        title: zod_1.z.string(),
        url: zod_1.z.string().url(),
        price: zod_1.z.string().optional(),
        imageUrl: zod_1.z.string().url().optional()
    })),
    timestamp: zod_1.z.string().datetime()
});
/**
 * Setup logging
 */
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ level, message, timestamp }) => {
        return `${timestamp} - ${level.toUpperCase()}: ${message}`;
    })),
    transports: [
        new winston.transports.Console()
    ]
});
/**
 * Product scraper class
 */
class ProductScraper {
    /**
     * Constructor
     * @param config Scraper configuration
     * @param outputPaths Output directory paths
     */
    constructor(config, outputPaths) {
        this.browser = null;
        this.config = config;
        this.outputPaths = outputPaths;
        this.stats = {
            start_time: new Date().toISOString(),
            pages_visited: 0,
            products_scraped: 0,
            images_found: 0,
            variants_found: 0,
            reviews_processed: 0,
            related_products_found: 0,
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
        const schemaPath = path.join(outputPaths.schemas, 'product_schema.json');
        fs.writeFileSync(schemaPath, JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
                title: { type: "string" },
                url: { type: "string", format: "uri" },
                sku: { type: "string" },
                description: { type: "string" },
                price: {
                    type: "object",
                    properties: {
                        amount: { type: "number" },
                        currency: { type: "string" },
                        formatted: { type: "string" },
                        discounted: { type: "boolean" }
                    },
                    required: ["amount", "currency", "formatted", "discounted"]
                },
                images: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            url: { type: "string", format: "uri" },
                            alt: { type: "string" },
                            isMain: { type: "boolean" }
                        }
                    }
                },
                variants: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            value: { type: "string" },
                            available: { type: "boolean" }
                        }
                    }
                }
            },
            required: ["title", "url", "sku", "price"]
        }, null, 2));
        logger.info(`Initialized product scraper with target URL: ${this.config.url || 'Not specified'}`);
    }
    /**
     * Parse a price string into a structured price object
     * @param priceText The price text to parse
     * @param currencySymbol Optional currency symbol to use
     * @returns Structured price object
     */
    parsePrice(priceText, currencySymbol) {
        if (!priceText) {
            return {
                amount: 0,
                currency: currencySymbol || 'USD',
                formatted: '$0.00',
                discounted: false
            };
        }
        try {
            // Clean the price text
            const cleanText = priceText.trim();
            // Check if there's a discounted price
            const hasDiscount = cleanText.includes('$') && (cleanText.match(/\$/g) || []).length > 1;
            // Default values
            let amount = 0;
            let currency = currencySymbol || 'USD';
            let formatted = cleanText;
            let originalAmount;
            let originalFormatted;
            let discountPercentage;
            // Extract the current price
            const priceMatch = cleanText.match(/([₹$€£¥])\s*([0-9,]+(\.[0-9]{2})?)/);
            if (priceMatch) {
                currency = this.getCurrencyCode(priceMatch[1]);
                amount = parseFloat(priceMatch[2].replace(/,/g, ''));
                formatted = `${priceMatch[1]}${priceMatch[2]}`;
            }
            else {
                // Try to extract just numbers
                const numericMatch = cleanText.match(/([0-9,]+(\.[0-9]{2})?)/);
                if (numericMatch) {
                    amount = parseFloat(numericMatch[1].replace(/,/g, ''));
                    formatted = `${currencySymbol || '$'}${numericMatch[1]}`;
                }
            }
            // If there's a discount, extract the original price
            if (hasDiscount) {
                const originalMatch = cleanText.match(/([₹$€£¥])\s*([0-9,]+(\.[0-9]{2})?).*([₹$€£¥])\s*([0-9,]+(\.[0-9]{2})?)/);
                if (originalMatch) {
                    // Determine which price is higher (original)
                    const price1 = parseFloat(originalMatch[2].replace(/,/g, ''));
                    const price2 = parseFloat(originalMatch[5].replace(/,/g, ''));
                    if (price1 > price2) {
                        originalAmount = price1;
                        originalFormatted = `${originalMatch[1]}${originalMatch[2]}`;
                        amount = price2;
                        formatted = `${originalMatch[4]}${originalMatch[5]}`;
                    }
                    else {
                        originalAmount = price2;
                        originalFormatted = `${originalMatch[4]}${originalMatch[5]}`;
                        amount = price1;
                        formatted = `${originalMatch[1]}${originalMatch[2]}`;
                    }
                    // Calculate discount percentage
                    if (originalAmount > 0) {
                        discountPercentage = Math.round(((originalAmount - amount) / originalAmount) * 100);
                    }
                }
            }
            return {
                amount,
                currency,
                formatted,
                discounted: hasDiscount,
                originalAmount,
                originalFormatted,
                discountPercentage
            };
        }
        catch (error) {
            logger.warn(`Error parsing price "${priceText}": ${error instanceof Error ? error.message : String(error)}`);
            return {
                amount: 0,
                currency: currencySymbol || 'USD',
                formatted: priceText,
                discounted: false
            };
        }
    }
    /**
     * Convert currency symbol to ISO currency code
     * @param symbol Currency symbol
     * @returns ISO currency code
     */
    getCurrencyCode(symbol) {
        const currencyMap = {
            '$': 'USD',
            '€': 'EUR',
            '£': 'GBP',
            '¥': 'JPY',
            '₹': 'INR',
            '₽': 'RUB',
            '₩': 'KRW',
            '₫': 'VND',
            '฿': 'THB',
            '₴': 'UAH',
            '₺': 'TRY'
        };
        return currencyMap[symbol] || 'USD';
    }
    /**
     * Extract star rating from text or element class
     * @param ratingText Rating text or class to parse
     * @returns Rating value (0-5)
     */
    parseRating(ratingText) {
        try {
            // Check for numeric value in text
            const numericMatch = ratingText.match(/([0-9]\.[0-9]|[0-5])/);
            if (numericMatch) {
                return parseFloat(numericMatch[1]);
            }
            // Check for star representations (e.g., "★★★☆☆" or "***--")
            const fullStars = (ratingText.match(/★/g) || []).length + (ratingText.match(/\*/g) || []).length;
            const emptyStars = (ratingText.match(/☆/g) || []).length + (ratingText.match(/-/g) || []).length;
            if (fullStars > 0 || emptyStars > 0) {
                return fullStars / (fullStars + emptyStars) * 5;
            }
            // Check for percentage (e.g., "80%")
            const percentMatch = ratingText.match(/([0-9]+)%/);
            if (percentMatch) {
                return Math.round(parseInt(percentMatch[1]) / 20 * 100) / 100;
            }
            return 0;
        }
        catch (error) {
            return 0;
        }
    }
    /**
     * Scrape a product using Puppeteer
     * @returns Promise resolving to the scraped product
     */
    async scrapeWithPuppeteer() {
        const targetUrl = this.config.url || 'https://shop.example.com';
        const selectors = this.config.selectors;
        const options = this.config.options || {};
        logger.info(`Starting Puppeteer product scrape of ${targetUrl}`);
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
            await page.goto(targetUrl, {
                waitUntil: options.waitForNetworkIdle ? 'networkidle2' : 'domcontentloaded'
            });
            // Wait for specific selector if configured
            if (options.waitForSelector) {
                await page.waitForSelector(options.waitForSelector, { timeout: options.timeout || 30000 });
            }
            // Scroll to bottom if configured (useful for lazy-loaded content)
            if (options.scrollToBottom) {
                await this.autoScroll(page);
            }
            // Update stats
            this.stats.pages_visited++;
            // Get page content size
            const content = await page.content();
            this.stats.bytes_downloaded += content.length;
            logger.info(`Successfully loaded ${targetUrl}`);
            // Extract basic product data
            const productTitle = await this.extractText(page, selectors.productTitle);
            const priceText = await this.extractText(page, selectors.price);
            const description = await this.extractText(page, selectors.description);
            const sku = await this.extractText(page, selectors.sku);
            const stockText = await this.extractText(page, selectors.stock);
            // Parse stock status
            const inStock = this.parseStockStatus(stockText);
            // Parse price
            const price = this.parsePrice(priceText, options.currency);
            // Extract images
            const images = await this.extractImages(page, selectors.images, options.maxImages || 10);
            this.stats.images_found += images.length;
            // Extract variants
            const variants = await this.extractVariants(page, selectors.variants);
            this.stats.variants_found += variants.length;
            // Extract reviews
            const reviews = await this.extractReviews(page, selectors.reviews, selectors.rating, options.maxReviews || 5);
            this.stats.reviews_processed += reviews.length;
            // Extract rating
            const rating = await this.extractRating(page, selectors.rating, reviews);
            // Extract related products
            const relatedProducts = await this.extractRelatedProducts(page, selectors.relatedProducts || '.related-products .product', options.maxRelatedProducts || 5);
            this.stats.related_products_found += relatedProducts.length;
            // Create short description (first 200 chars)
            const shortDescription = description.length > 200
                ? description.substring(0, 200).trim() + '...'
                : description;
            // Create product object
            const product = {
                title: productTitle || 'Unknown Product',
                url: targetUrl,
                sku: sku || 'UNKNOWN',
                description,
                shortDescription,
                price,
                images,
                variants,
                reviews,
                rating,
                metadata: {
                    inStock,
                    stockLevel: this.parseStockLevel(stockText),
                    tags: []
                },
                relatedProducts,
                timestamp: new Date().toISOString()
            };
            // Update stats
            this.stats.products_scraped++;
            logger.info(`Successfully scraped product: ${product.title}`);
            return product;
        }
        catch (error) {
            this.stats.errors++;
            logger.error(`Puppeteer scraping error: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                logger.error(`Stack trace: ${error.stack}`);
            }
            return null;
        }
        finally {
            // Close browser
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }
        }
    }
    /**
     * Helper to extract text from a selector
     */
    async extractText(page, selector) {
        try {
            const element = await page.$(selector);
            if (element) {
                const textContent = await page.evaluate(el => el.textContent, element);
                return (textContent || '').trim();
            }
            return '';
        }
        catch (error) {
            logger.debug(`Error extracting text from ${selector}: ${error instanceof Error ? error.message : String(error)}`);
            return '';
        }
    }
    /**
     * Helper to auto-scroll a page to the bottom
     */
    async autoScroll(page) {
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
    }
    /**
     * Extract product images
     */
    async extractImages(page, selector, maxImages) {
        try {
            return await page.evaluate((selector, maxImages) => {
                const images = [];
                const imageElements = document.querySelectorAll(selector);
                // Handle case where selector finds <img> tags directly
                if (imageElements[0]?.tagName === 'IMG') {
                    Array.from(imageElements).slice(0, maxImages).forEach((img, index) => {
                        const imgElement = img;
                        images.push({
                            url: imgElement.src,
                            alt: imgElement.alt || '',
                            isMain: index === 0,
                            thumbnailUrl: imgElement.dataset.thumbnail,
                            position: index
                        });
                    });
                }
                // Handle case where selector finds containers with background images
                else {
                    Array.from(imageElements).slice(0, maxImages).forEach((container, index) => {
                        // Try to find img inside container
                        const imgElement = container.querySelector('img');
                        if (imgElement) {
                            images.push({
                                url: imgElement.src,
                                alt: imgElement.alt || '',
                                isMain: index === 0,
                                thumbnailUrl: imgElement.dataset.thumbnail,
                                position: index
                            });
                        }
                        // Try to extract background image
                        else {
                            const style = window.getComputedStyle(container);
                            const bgImage = style.backgroundImage;
                            if (bgImage && bgImage !== 'none') {
                                const url = bgImage.replace(/url\(['"]?([^'"]+)['"]?\)/gi, '$1');
                                images.push({
                                    url,
                                    alt: container.getAttribute('title') || container.getAttribute('aria-label') || '',
                                    isMain: index === 0,
                                    position: index
                                });
                            }
                        }
                    });
                }
                return images;
            }, selector, maxImages);
        }
        catch (error) {
            logger.error(`Error extracting images: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
    /**
     * Extract product variants
     */
    async extractVariants(page, selector) {
        try {
            return await page.evaluate((selector) => {
                const variants = [];
                // Look for select dropdowns first
                const selectElements = document.querySelectorAll(`${selector} select`);
                if (selectElements.length > 0) {
                    selectElements.forEach(select => {
                        const variantName = select.getAttribute('name') ||
                            select.getAttribute('id') ||
                            select.getAttribute('aria-label') ||
                            'Option';
                        Array.from(select.options).forEach(option => {
                            if (option.value && !option.disabled) {
                                variants.push({
                                    name: variantName,
                                    value: option.textContent?.trim() || option.value,
                                    price: option.dataset.price,
                                    available: !option.disabled,
                                    sku: option.dataset.sku
                                });
                            }
                        });
                    });
                }
                // Look for radio buttons and checkboxes
                const inputElements = document.querySelectorAll(`${selector} input[type="radio"], ${selector} input[type="checkbox"]`);
                if (inputElements.length > 0) {
                    const groupedInputs = {};
                    inputElements.forEach(input => {
                        const inputElement = input;
                        const name = inputElement.name;
                        if (!groupedInputs[name]) {
                            groupedInputs[name] = [];
                        }
                        groupedInputs[name].push(inputElement);
                    });
                    Object.entries(groupedInputs).forEach(([name, inputs]) => {
                        inputs.forEach(input => {
                            const label = document.querySelector(`label[for="${input.id}"]`);
                            const valueText = label?.textContent?.trim() || input.value;
                            variants.push({
                                name,
                                value: valueText,
                                available: !input.disabled,
                                sku: input.dataset.sku
                            });
                        });
                    });
                }
                // Look for swatch elements or variant buttons
                const swatchElements = document.querySelectorAll(`${selector} .swatch, ${selector} .variant-option, ${selector} .color-option`);
                if (swatchElements.length > 0) {
                    // Try to determine variant type from container
                    const container = swatchElements[0].parentElement;
                    const variantName = container?.querySelector('label, .label, .option-name')?.textContent?.trim() || 'Option';
                    swatchElements.forEach(swatch => {
                        const value = swatch.getAttribute('title') ||
                            swatch.getAttribute('data-value') ||
                            swatch.textContent?.trim() ||
                            '';
                        const available = !swatch.classList.contains('disabled') &&
                            !swatch.classList.contains('sold-out') &&
                            !swatch.hasAttribute('disabled');
                        variants.push({
                            name: variantName,
                            value,
                            available,
                            sku: swatch.getAttribute('data-sku')
                        });
                    });
                }
                return variants;
            }, selector);
        }
        catch (error) {
            logger.error(`Error extracting variants: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
    /**
     * Extract product reviews
     */
    async extractReviews(page, reviewSelector, ratingSelector, maxReviews) {
        try {
            return await page.evaluate((reviewSelector, ratingSelector, maxReviews) => {
                const reviews = [];
                const reviewElements = document.querySelectorAll(reviewSelector);
                Array.from(reviewElements).slice(0, maxReviews).forEach(review => {
                    // Try to find common review elements
                    const authorElement = review.querySelector('.author, .reviewer, .user, [itemprop="author"]');
                    const dateElement = review.querySelector('.date, .review-date, [itemprop="datePublished"]');
                    const titleElement = review.querySelector('.title, .review-title, [itemprop="name"]');
                    const textElement = review.querySelector('.text, .content, .review-text, [itemprop="reviewBody"]');
                    const ratingElement = review.querySelector(ratingSelector + ', .rating, .stars, [itemprop="ratingValue"]');
                    // Extract values
                    const author = authorElement?.textContent?.trim() || 'Anonymous';
                    const date = dateElement?.textContent?.trim() || new Date().toISOString().split('T')[0];
                    const title = titleElement?.textContent?.trim();
                    const text = textElement?.textContent?.trim() || '';
                    // Extract rating
                    let rating = 0;
                    if (ratingElement) {
                        const ratingText = ratingElement.textContent?.trim() || '';
                        const ratingValue = ratingElement.getAttribute('data-rating') || '';
                        if (ratingValue && !isNaN(parseFloat(ratingValue))) {
                            rating = parseFloat(ratingValue);
                        }
                        else if (ratingText.match(/[0-5](\.[0-9])?\/5/)) {
                            // Format: "4.5/5"
                            rating = parseFloat(ratingText.split('/')[0]);
                        }
                        else if (ratingText.match(/[0-9](\.[0-9])?/)) {
                            // Simple number
                            rating = parseFloat(ratingText);
                        }
                        else {
                            // Count stars in the element
                            const fullStars = ratingElement.querySelectorAll('.full-star, .star-full, .star.filled').length;
                            const halfStars = ratingElement.querySelectorAll('.half-star, .star-half').length;
                            const totalStars = ratingElement.querySelectorAll('.star, .star-container > *').length || 5;
                            if (fullStars > 0 || halfStars > 0) {
                                rating = (fullStars + halfStars * 0.5) / (totalStars / 5);
                            }
                        }
                    }
                    // Clamp rating between 0-5
                    rating = Math.max(0, Math.min(5, rating));
                    // Find helpful votes
                    const helpfulElement = review.querySelector('.helpful-count, .helpful, .vote-count');
                    const helpful = helpfulElement ? parseInt(helpfulElement.textContent?.replace(/[^\d]/g, '') || '0') : undefined;
                    reviews.push({
                        author,
                        rating,
                        date,
                        title,
                        text,
                        helpful
                    });
                });
                return reviews;
            }, reviewSelector, ratingSelector, maxReviews);
        }
        catch (error) {
            logger.error(`Error extracting reviews: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
    /**
     * Extract product rating
     */
    async extractRating(page, selector, reviews) {
        try {
            const ratingData = await page.evaluate((selector) => {
                // Try to find the average rating
                const ratingElement = document.querySelector(selector + ', .rating, .product-rating, [itemprop="ratingValue"]');
                const countElement = document.querySelector('.review-count, .rating-count, [itemprop="reviewCount"]');
                let average = 0;
                let count = 0;
                const distribution = {};
                if (ratingElement) {
                    const ratingText = ratingElement.textContent?.trim() || '';
                    const ratingValue = ratingElement.getAttribute('data-rating') ||
                        ratingElement.getAttribute('content') || '';
                    if (ratingValue && !isNaN(parseFloat(ratingValue))) {
                        average = parseFloat(ratingValue);
                    }
                    else if (ratingText.match(/[0-5](\.[0-9])?\/5/)) {
                        // Format: "4.5/5"
                        average = parseFloat(ratingText.split('/')[0]);
                    }
                    else if (ratingText.match(/[0-9](\.[0-9])?/)) {
                        // Simple number
                        average = parseFloat(ratingText);
                    }
                    else {
                        // Count stars in the element
                        const fullStars = ratingElement.querySelectorAll('.full-star, .star-full, .star.filled').length;
                        const halfStars = ratingElement.querySelectorAll('.half-star, .star-half').length;
                        const totalStars = ratingElement.querySelectorAll('.star, .star-container > *').length || 5;
                        if (fullStars > 0 || halfStars > 0) {
                            average = (fullStars + halfStars * 0.5) / (totalStars / 5);
                        }
                    }
                }
                // Find review count
                if (countElement) {
                    const countText = countElement.textContent?.trim() || '';
                    const countMatch = countText.match(/\d+/);
                    if (countMatch) {
                        count = parseInt(countMatch[0]);
                    }
                }
                // Try to find rating distribution
                const distributionElements = document.querySelectorAll('.rating-distribution .rating-bar, .rating-breakdown .rating-row');
                distributionElements.forEach(element => {
                    const stars = element.querySelector('.star-label, .rating-label')?.textContent?.trim() || '';
                    const starMatch = stars.match(/([1-5])\s+star/i);
                    const countElement = element.querySelector('.count, .rating-count');
                    const countText = countElement?.textContent?.trim() || '';
                    const countMatch = countText.match(/\d+/);
                    if (starMatch && countMatch) {
                        distribution[starMatch[1]] = parseInt(countMatch[0]);
                    }
                });
                return { average, count, distribution: Object.keys(distribution).length > 0 ? distribution : undefined };
            }, selector);
            // If we couldn't get an average from the page but have reviews, calculate it
            if (ratingData.average === 0 && reviews.length > 0) {
                const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
                ratingData.average = totalRating / reviews.length;
            }
            // If we couldn't get a count but have reviews, use the review count
            if (ratingData.count === 0 && reviews.length > 0) {
                ratingData.count = reviews.length;
            }
            return ratingData;
        }
        catch (error) {
            logger.error(`Error extracting rating: ${error instanceof Error ? error.message : String(error)}`);
            // Fallback to calculating from reviews
            if (reviews.length > 0) {
                const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
                return {
                    average: totalRating / reviews.length,
                    count: reviews.length
                };
            }
            return {
                average: 0,
                count: 0
            };
        }
    }
    /**
     * Extract related products
     */
    async extractRelatedProducts(page, selector, maxProducts) {
        try {
            return await page.evaluate((selector, maxProducts) => {
                const products = [];
                const productElements = document.querySelectorAll(selector);
                Array.from(productElements).slice(0, maxProducts).forEach(product => {
                    // Find title and URL (usually in an anchor tag)
                    const linkElement = product.querySelector('a');
                    const titleElement = product.querySelector('.title, .product-title, .name, h3, h4');
                    const priceElement = product.querySelector('.price, .product-price');
                    const imageElement = product.querySelector('img');
                    const title = titleElement?.textContent?.trim() ||
                        linkElement?.getAttribute('title') ||
                        'Related Product';
                    const url = linkElement?.href || '';
                    const price = priceElement?.textContent?.trim();
                    const imageUrl = imageElement?.src;
                    if (title && url) {
                        products.push({
                            title,
                            url,
                            price,
                            imageUrl
                        });
                    }
                });
                return products;
            }, selector, maxProducts);
        }
        catch (error) {
            logger.error(`Error extracting related products: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
    /**
     * Parse stock status from text
     */
    parseStockStatus(text) {
        if (!text)
            return true; // Default to in stock if no information
        const lowercaseText = text.toLowerCase();
        // Common out of stock indicators
        const outOfStockIndicators = [
            'out of stock',
            'sold out',
            'unavailable',
            'no longer available',
            'not available',
            'out-of-stock',
            'not in stock',
            'backordered'
        ];
        for (const indicator of outOfStockIndicators) {
            if (lowercaseText.includes(indicator)) {
                return false;
            }
        }
        // Common in stock indicators
        const inStockIndicators = [
            'in stock',
            'available',
            'in-stock',
            'ships',
            'shipping',
            'add to cart',
            'buy now',
            'ship'
        ];
        for (const indicator of inStockIndicators) {
            if (lowercaseText.includes(indicator)) {
                return true;
            }
        }
        return true; // Default to in stock
    }
    /**
     * Parse stock level from text
     */
    parseStockLevel(text) {
        if (!text)
            return undefined;
        const lowercaseText = text.toLowerCase();
        // Try to find numeric stock level
        const numericMatch = text.match(/(\d+)\s*(left|available|in stock|item)/i);
        if (numericMatch) {
            return parseInt(numericMatch[1]);
        }
        // Check for stock indicators
        if (lowercaseText.includes('low stock') || lowercaseText.includes('selling fast')) {
            return 'LOW';
        }
        if (lowercaseText.includes('out of stock') || lowercaseText.includes('sold out')) {
            return 0;
        }
        return undefined;
    }
    /**
     * Alternative method to scrape using Axios and Cheerio
     */
    async scrapeWithCheerio() {
        const targetUrl = this.config.url || 'https://shop.example.com';
        const selectors = this.config.selectors;
        const options = this.config.options || {};
        logger.info(`Starting Cheerio product scrape of ${targetUrl}`);
        try {
            // Fetch page content
            const response = await axios_1.default.get(targetUrl, {
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
            // Extract basic product data
            const productTitle = $(selectors.productTitle).first().text().trim();
            const priceText = $(selectors.price).first().text().trim();
            const description = $(selectors.description).text().trim();
            const sku = $(selectors.sku).first().text().trim() ||
                $(selectors.sku).first().attr('content') ||
                'UNKNOWN';
            const stockText = $(selectors.stock).first().text().trim();
            // Parse stock status
            const inStock = this.parseStockStatus(stockText);
            // Parse price
            const price = this.parsePrice(priceText, options.currency);
            // Extract images
            const images = [];
            $(selectors.images).slice(0, options.maxImages || 10).each((index, el) => {
                if ($(el).is('img')) {
                    images.push({
                        url: $(el).attr('src') || '',
                        alt: $(el).attr('alt') || '',
                        isMain: index === 0,
                        thumbnailUrl: $(el).data('thumbnail'),
                        position: index
                    });
                }
                else {
                    const img = $(el).find('img').first();
                    if (img.length) {
                        images.push({
                            url: img.attr('src') || '',
                            alt: img.attr('alt') || '',
                            isMain: index === 0,
                            thumbnailUrl: img.data('thumbnail'),
                            position: index
                        });
                    }
                }
            });
            this.stats.images_found += images.length;
            // Extract variants (simplified for Cheerio)
            const variants = [];
            $(selectors.variants).each((index, el) => {
                const name = $(el).find('label').first().text().trim() || 'Option';
                const value = $(el).text().trim();
                const available = !$(el).hasClass('disabled') && !$(el).hasClass('sold-out');
                if (value) {
                    variants.push({
                        name,
                        value,
                        available,
                        sku: $(el).data('sku')
                    });
                }
            });
            this.stats.variants_found += variants.length;
            // Extract reviews (simplified for Cheerio)
            const reviews = [];
            $(selectors.reviews).slice(0, options.maxReviews || 5).each((index, el) => {
                const author = $(el).find('.author, .reviewer, .user').first().text().trim() || 'Anonymous';
                const dateText = $(el).find('.date, .review-date').first().text().trim();
                const title = $(el).find('.title, .review-title').first().text().trim();
                const text = $(el).find('.text, .content, .review-text').first().text().trim();
                const ratingText = $(el).find('.rating, .stars').first().text().trim();
                reviews.push({
                    author,
                    rating: this.parseRating(ratingText),
                    date: dateText || new Date().toISOString().split('T')[0],
                    title: title || undefined,
                    text: text || 'No review text'
                });
            });
            this.stats.reviews_processed += reviews.length;
            // Extract rating
            const ratingText = $(selectors.rating).first().text().trim();
            const ratingValue = $(selectors.rating).first().data('rating') ||
                $(selectors.rating).first().attr('content');
            let ratingAverage = 0;
            if (ratingValue !== undefined && !isNaN(parseFloat(String(ratingValue)))) {
                ratingAverage = parseFloat(String(ratingValue));
            }
            else {
                ratingAverage = this.parseRating(ratingText);
            }
            const ratingCount = parseInt($('.review-count, .rating-count').text().replace(/[^\d]/g, '') || '0');
            // Extract related products (simplified for Cheerio)
            const relatedProducts = [];
            $(selectors.relatedProducts || '.related-products .product').slice(0, options.maxRelatedProducts || 5).each((index, el) => {
                const title = $(el).find('.title, .product-title, .name').first().text().trim();
                const linkElement = $(el).find('a').first();
                const url = linkElement.attr('href') || '';
                const price = $(el).find('.price, .product-price').first().text().trim();
                const imageUrl = $(el).find('img').first().attr('src');
                if (title && url) {
                    relatedProducts.push({
                        title,
                        url: url.startsWith('http') ? url : new URL(url, targetUrl).toString(),
                        price,
                        imageUrl
                    });
                }
            });
            this.stats.related_products_found += relatedProducts.length;
            // Create short description (first 200 chars)
            const shortDescription = description.length > 200
                ? description.substring(0, 200).trim() + '...'
                : description;
            // Create product object
            const product = {
                title: productTitle || 'Unknown Product',
                url: targetUrl,
                sku,
                description,
                shortDescription,
                price,
                images,
                variants,
                reviews,
                rating: {
                    average: ratingAverage,
                    count: ratingCount || reviews.length,
                },
                metadata: {
                    inStock,
                    stockLevel: this.parseStockLevel(stockText),
                    tags: []
                },
                relatedProducts,
                timestamp: new Date().toISOString()
            };
            // Update stats
            this.stats.products_scraped++;
            logger.info(`Successfully scraped product: ${product.title}`);
            return product;
        }
        catch (error) {
            this.stats.errors++;
            logger.error(`Cheerio scraping error: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                logger.error(`Stack trace: ${error.stack}`);
            }
            return null;
        }
    }
    /**
     * Save the scraped product data to files
     * @param product The scraped product
     */
    async saveData(product) {
        if (!product) {
            logger.warn('No product to save');
            return;
        }
        try {
            // Validate product against schema
            try {
                ScrapedProductSchema.parse(product);
                logger.info('Product validation successful');
            }
            catch (error) {
                logger.warn(`Product validation failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            // Save as JSON
            const dataFile = path.join(this.outputPaths.data, 'product.json');
            fs.writeFileSync(dataFile, JSON.stringify(product, null, 2));
            // Create a simplified version for export
            const simpleProduct = {
                title: product.title,
                url: product.url,
                sku: product.sku,
                price: product.price.formatted,
                description: product.shortDescription,
                inStock: product.metadata.inStock ? 'Yes' : 'No',
                images: product.images.length,
                variants: product.variants.map(v => `${v.name}: ${v.value}`).join(', '),
                rating: `${product.rating.average}/5 (${product.rating.count} reviews)`
            };
            // Save as CSV
            const exportFile = path.join(this.outputPaths.exports, 'product.csv');
            fs.writeFileSync(exportFile, Object.keys(simpleProduct).join(',') + '\n' +
                Object.values(simpleProduct).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
            // Save individual images data
            const imagesDir = path.join(this.outputPaths.data, 'images');
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
            fs.writeFileSync(path.join(imagesDir, 'images.json'), JSON.stringify(product.images, null, 2));
            // Save variants data
            const variantsDir = path.join(this.outputPaths.data, 'variants');
            if (!fs.existsSync(variantsDir)) {
                fs.mkdirSync(variantsDir, { recursive: true });
            }
            fs.writeFileSync(path.join(variantsDir, 'variants.json'), JSON.stringify(product.variants, null, 2));
            // Save reviews data
            if (product.reviews.length > 0) {
                const reviewsDir = path.join(this.outputPaths.data, 'reviews');
                if (!fs.existsSync(reviewsDir)) {
                    fs.mkdirSync(reviewsDir, { recursive: true });
                }
                fs.writeFileSync(path.join(reviewsDir, 'reviews.json'), JSON.stringify(product.reviews, null, 2));
            }
            logger.info(`Saved product data to ${dataFile} and exported to ${exportFile}`);
        }
        catch (error) {
            this.stats.errors++;
            logger.error(`Error saving data: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Generate a report of the scraping process
     * @returns Scraper statistics
     */
    generateReport() {
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
async function run(config, outputPaths) {
    try {
        // Initialize and run the scraper
        const scraper = new ProductScraper(config, outputPaths);
        // Choose scraping method based on complexity
        const usePuppeteer = true; // Default to Puppeteer for product scraping
        const product = usePuppeteer ?
            await scraper.scrapeWithPuppeteer() :
            await scraper.scrapeWithCheerio();
        await scraper.saveData(product);
        const stats = scraper.generateReport();
        return {
            success: product !== null,
            items_scraped: product ? 1 : 0,
            stats
        };
    }
    catch (error) {
        logger.error(`Error running product scraper: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
            logger.error(`Stack trace: ${error.stack}`);
        }
        return {
            success: false,
            items_scraped: 0,
            stats: {
                start_time: new Date().toISOString(),
                pages_visited: 0,
                products_scraped: 0,
                images_found: 0,
                variants_found: 0,
                reviews_processed: 0,
                related_products_found: 0,
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
    const argv = (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
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
        default: 'https://shop.example.com'
    })
        .help()
        .alias('help', 'h')
        .parseSync();
    try {
        // Load config from file or use defaults
        let config;
        if (argv.config && typeof argv.config === 'string' && fs.existsSync(argv.config)) {
            const configContent = fs.readFileSync(argv.config, 'utf8');
            const ext = path.extname(argv.config).toLowerCase();
            if (ext === '.json') {
                config = JSON.parse(configContent);
            }
            else if (ext === '.yaml' || ext === '.yml') {
                config = yaml.parse(configContent);
            }
            else {
                throw new Error(`Unsupported config file format: ${ext}`);
            }
        }
        else {
            // Use default configuration
            config = {
                url: typeof argv.url === 'string' ? argv.url : 'https://shop.example.com',
                selectors: {
                    productTitle: 'h1.product-title, .product-title h1, .product-name h1',
                    price: '.product-price, .price, .current-price',
                    description: '.product-description, .description, [itemprop="description"]',
                    images: '.product-images img, .product-gallery img, .product-image',
                    variants: '.product-variants, .product-options, .variants',
                    reviews: '.product-review, .review, .customer-review',
                    rating: '.product-rating, .rating, [itemprop="ratingValue"]',
                    sku: '.product-sku, .sku, [itemprop="sku"]',
                    stock: '.stock-status, .availability, .in-stock'
                },
                options: {
                    maxRelatedProducts: 5,
                    maxReviews: 10,
                    maxImages: 10,
                    delay: 1000,
                    timeout: 30000,
                    headless: true,
                    currency: 'USD',
                    scrollToBottom: true,
                    waitForNetworkIdle: true
                }
            };
        }
        // Create output paths
        const outputBase = typeof argv.output === 'string' ? argv.output : './output';
        const outputPaths = {
            data: path.join(outputBase, 'data'),
            exports: path.join(outputBase, 'exports'),
            schemas: path.join(outputBase, 'schemas')
        };
        // Run the scraper
        logger.info('Starting product scraper...');
        const result = await run(config, outputPaths);
        // Output result
        console.log(JSON.stringify(result, null, 2));
        // Return success status
        process.exit(result.success ? 0 : 1);
    }
    catch (error) {
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
//# sourceMappingURL=product_scraper.js.map
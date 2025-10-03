const { parseDocument } = require("htmlparser2");
const { select, clearCaches } = require("./lib/index.js");

// Generate test HTML
function generateTestHTML(depth = 3, breadth = 5) {
    let html = '<html><body>';

    function generateLevel(level, maxLevel) {
        if (level > maxLevel) return '';

        let content = '';
        for (let i = 0; i < breadth; i++) {
            const id = `id-${level}-${i}`;
            const className = `class-${level} common-class`;
            content += `<div id="${id}" class="${className}">
                <span class="inner">Content ${level}-${i}</span>
                <p>Paragraph ${level}-${i}</p>
                ${generateLevel(level + 1, maxLevel)}
            </div>`;
        }
        return content;
    }

    html += generateLevel(1, depth);
    html += '</body></html>';
    return html;
}

// Benchmark function
function benchmark(name, fn, iterations = 10000) {
    // Warmup
    for (let i = 0; i < 100; i++) fn();

    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
        fn();
    }
    const end = process.hrtime.bigint();

    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    const opsPerSec = (iterations / duration) * 1000;

    console.log(`${name.padEnd(50)} ${opsPerSec.toFixed(0).padStart(12)} ops/sec`);
    return opsPerSec;
}

// Generate test document (smaller for reasonable benchmark times)
const html = generateTestHTML(4, 6);
const doc = parseDocument(html);

console.log('\n=== cheerio-select Performance Benchmark ===\n');
console.log(`Document Stats:`);
console.log(`  - Total HTML size: ${html.length.toLocaleString()} bytes`);
console.log(`  - Approximate nodes: ${html.split('<').length - 1}\n`);

console.log('Test                                                   ops/sec');
console.log('='.repeat(70));

// Simple selector benchmarks
console.log('\n--- Simple Selectors (Fast Paths) ---');
benchmark('ID selector: #id-3-5', () => {
    select('#id-3-5', doc);
});

benchmark('Class selector: .common-class', () => {
    select('.common-class', doc);
});

benchmark('Tag selector: div', () => {
    select('div', doc);
});

benchmark('Tag selector: span', () => {
    select('span', doc);
});

// Complex selector benchmarks
console.log('\n--- Complex Selectors ---');
benchmark('Descendant: div span', () => {
    select('div span', doc);
});

benchmark('Child combinator: div > span', () => {
    select('div > span', doc);
});

benchmark('Multiple classes: .class-3.common-class', () => {
    select('.class-3.common-class', doc);
});

benchmark('Attribute selector: [id^="id-3"]', () => {
    select('[id^="id-3"]', doc);
});

// Pseudo-class benchmarks
console.log('\n--- Pseudo-class Selectors (Optimized) ---');
benchmark(':first-child', () => {
    select('div:first-child', doc);
});

benchmark(':last-child', () => {
    select('div:last-child', doc);
});

benchmark(':nth-child(2)', () => {
    select('div:nth-child(2)', doc);
});

benchmark(':first pseudo', () => {
    select('div:first', doc);
});

benchmark(':last pseudo', () => {
    select('div:last', doc);
});

benchmark(':eq(5) pseudo', () => {
    select('div:eq(5)', doc);
});

benchmark(':even pseudo', () => {
    select('div:even', doc);
});

benchmark(':odd pseudo', () => {
    select('div:odd', doc);
});

// Cached vs uncached performance
console.log('\n--- Caching Performance ---');

const selector = 'div.common-class > span.inner';

// Clear cache and measure first run
clearCaches();
const uncachedOps = benchmark('Complex selector (uncached - first run)', () => {
    select(selector, doc);
}, 1000);

// Measure cached performance
const cachedOps = benchmark('Complex selector (cached - subsequent)', () => {
    select(selector, doc);
}, 10000);

const speedup = (cachedOps / uncachedOps).toFixed(2);
console.log(`\nCache speedup: ${speedup}x faster`);

// Multiple selector performance
console.log('\n--- Multiple Selectors ---');
benchmark('Union: div, span, p', () => {
    select('div, span, p', doc);
});

benchmark('Complex union: .class-3, #id-2-1, span', () => {
    select('.class-3, #id-2-1, span', doc);
});

// Edge cases
console.log('\n--- Edge Cases ---');
benchmark('Universal selector: *', () => {
    select('*', doc);
}, 1000);

benchmark('Deep nesting: div div div div', () => {
    select('div div div div', doc);
});

benchmark(':not() selector', () => {
    select('div:not(.class-1)', doc);
});

console.log('\n' + '='.repeat(70));
console.log('\nBenchmark complete!\n');

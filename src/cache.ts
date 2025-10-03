import type { Selector } from "css-what";
import type { Element } from "domhandler";

/**
 * Cache for compiled selectors
 * Uses WeakMap to prevent memory leaks - entries are automatically
 * garbage collected when selector arrays are no longer referenced
 */
export const compiledSelectorCache = new WeakMap<
    Selector[][],
    Map<string, unknown>
>();

/**
 * Cache for match results
 * Key format: "selector_string|element_hash"
 */
export const matchResultCache = new Map<string, boolean>();

/**
 * Cache for parent/child relationships
 */
export const relationshipCache = new WeakMap<
    Element,
    WeakMap<Element, boolean>
>();

/**
 * Maximum cache size to prevent unbounded growth
 */
const MAX_MATCH_CACHE_SIZE = 10000;

/**
 * Get a cache key for match results
 */
export function getMatchCacheKey(selector: string, element: Element): string {
    // Use element reference and type for a reasonably unique key
    const id = element.attribs["id"] || "";
    const elementKey = `${element.type}_${element.name || ""}_${id}`;
    return `${selector}|${elementKey}`;
}

/**
 * Add to match result cache with size limiting
 */
export function addToMatchCache(key: string, value: boolean): void {
    if (matchResultCache.size >= MAX_MATCH_CACHE_SIZE) {
        // Simple LRU: clear half the cache when full
        const entriesToDelete = Math.floor(MAX_MATCH_CACHE_SIZE / 2);
        const iterator = matchResultCache.keys();
        for (let i = 0; i < entriesToDelete; i++) {
            const key = iterator.next().value;
            if (key) matchResultCache.delete(key);
        }
    }
    matchResultCache.set(key, value);
}

/**
 * Clear all caches (useful for testing)
 */
export function clearCaches(): void {
    matchResultCache.clear();
}

/**
 * Simple selector detection utilities
 */
export function isSimpleIdSelector(selector: Selector[][]): string | null {
    if (selector.length !== 1 || selector[0].length !== 1) return null;
    const sel = selector[0][0];
    return sel.type === "attribute" &&
        sel.name === "id" &&
        sel.action === "equals" &&
        typeof sel.value === "string"
        ? sel.value
        : null;
}

export function isSimpleClassSelector(selector: Selector[][]): string | null {
    if (selector.length !== 1 || selector[0].length !== 1) return null;
    const sel = selector[0][0];
    return sel.type === "attribute" &&
        sel.name === "class" &&
        sel.action === "element" &&
        typeof sel.value === "string"
        ? sel.value
        : null;
}

export function isSimpleTagSelector(selector: Selector[][]): string | null {
    if (selector.length !== 1 || selector[0].length !== 1) return null;
    const sel = selector[0][0];
    return sel.type === "tag" && typeof sel.name === "string" ? sel.name : null;
}

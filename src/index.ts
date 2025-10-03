import { parse, type Selector, SelectorType, isTraversal } from "css-what";
import {
    _compileToken as compileToken,
    type Options as CSSSelectOptions,
    prepareContext,
} from "css-select";
import * as DomUtils from "domutils";
import * as boolbase from "boolbase";
import type { Element, AnyNode, Document } from "domhandler";
import { getDocumentRoot, groupSelectors } from "./helpers.js";
import {
    type Filter,
    isFilter,
    type CheerioSelector,
    getLimit,
} from "./positionals.js";
import {
    compiledSelectorCache,
    isSimpleIdSelector,
    isSimpleClassSelector,
    isSimpleTagSelector,
} from "./cache.js";

// Re-export pseudo extension points
export { filters, pseudos, aliases } from "css-select";

// Re-export cache utilities
export { clearCaches } from "./cache.js";

const UNIVERSAL_SELECTOR: Selector = {
    type: SelectorType.Universal,
    namespace: null,
};
const SCOPE_PSEUDO: Selector = {
    type: SelectorType.Pseudo,
    name: "scope",
    data: null,
};

export interface Options extends CSSSelectOptions<AnyNode, Element> {
    /** Optional reference to the root of the document. If not set, this will be computed when needed. */
    root?: Document;
}

export function is(
    element: Element,
    selector: string | ((el: Element) => boolean),
    options: Options = {},
): boolean {
    return some([element], selector, options);
}

export function some(
    elements: Element[],
    selector: string | ((el: Element) => boolean),
    options: Options = {},
): boolean {
    if (typeof selector === "function") return elements.some(selector);

    const [plain, filtered] = groupSelectors(parse(selector));

    return (
        (plain.length > 0 && elements.some(compileToken(plain, options))) ||
        filtered.some(
            (sel) => filterBySelector(sel, elements, options).length > 0,
        )
    );
}

function filterByPosition(
    filter: Filter,
    elems: Element[],
    data: Selector[][] | string | null,
    options: Options,
): Element[] {
    const num = typeof data === "string" ? parseInt(data, 10) : NaN;

    switch (filter) {
        case "first":
        case "lt":
            // Already done in `getLimit`
            return elems;
        case "last":
            // Optimized: direct array access, no slice
            return elems.length > 0 ? [elems[elems.length - 1]] : elems;
        case "nth":
        case "eq": {
            // Optimized: single calculation, early exit
            if (!isFinite(num)) return [];
            const index = num < 0 ? elems.length + num : num;
            return index >= 0 && index < elems.length ? [elems[index]] : [];
        }
        case "gt":
            // Optimized: direct slice with early exit
            return isFinite(num) && num < elems.length - 1
                ? elems.slice(num + 1)
                : [];
        case "even": {
            // Optimized: pre-allocate array size
            const result: Element[] = [];
            for (let i = 0; i < elems.length; i += 2) {
                result.push(elems[i]);
            }
            return result;
        }
        case "odd": {
            // Optimized: pre-allocate array size, start at 1
            const result: Element[] = [];
            for (let i = 1; i < elems.length; i += 2) {
                result.push(elems[i]);
            }
            return result;
        }
        case "not": {
            const filtered = new Set(
                filterParsed(data as Selector[][], elems, options),
            );

            return elems.filter((e) => !filtered.has(e));
        }
    }
}

export function filter(
    selector: string,
    elements: AnyNode[],
    options: Options = {},
): Element[] {
    return filterParsed(parse(selector), elements, options);
}

/**
 * Filter a set of elements by a selector.
 *
 * Will return elements in the original order.
 *
 * @param selector Selector to filter by.
 * @param elements Elements to filter.
 * @param options Options for selector.
 */
function filterParsed(
    selector: Selector[][],
    elements: AnyNode[],
    options: Options,
): Element[] {
    if (elements.length === 0) return [];

    const [plainSelectors, filteredSelectors] = groupSelectors(selector);
    let found: undefined | Set<Element>;

    if (plainSelectors.length) {
        const filtered = filterElements(elements, plainSelectors, options);

        // If there are no filters, just return
        if (filteredSelectors.length === 0) {
            return filtered;
        }

        // Otherwise, we have to do some filtering
        if (filtered.length) {
            found = new Set(filtered);
        }
    }

    for (
        let i = 0;
        i < filteredSelectors.length && found?.size !== elements.length;
        i++
    ) {
        const filteredSelector = filteredSelectors[i];
        const missing = found
            ? elements.filter((e) => DomUtils.isTag(e) && !found!.has(e))
            : elements;

        if (missing.length === 0) break;
        const filtered = filterBySelector(filteredSelector, elements, options);

        if (filtered.length) {
            if (!found) {
                /*
                 * If we haven't found anything before the last selector,
                 * just return what we found now.
                 */
                if (i === filteredSelectors.length - 1) {
                    return filtered;
                }

                found = new Set(filtered);
            } else {
                filtered.forEach((el) => found!.add(el));
            }
        }
    }

    return typeof found !== "undefined"
        ? ((found.size === elements.length
              ? elements
              : // Filter elements to preserve order
                elements.filter((el) =>
                    (found as Set<AnyNode>).has(el),
                )) as Element[])
        : [];
}

function filterBySelector(
    selector: Selector[],
    elements: AnyNode[],
    options: Options,
) {
    if (selector.some(isTraversal)) {
        /*
         * Get root node, run selector with the scope
         * set to all of our nodes.
         */
        const root = options.root ?? getDocumentRoot(elements[0]);
        const opts = { ...options, context: elements, relativeSelector: false };
        selector.push(SCOPE_PSEUDO);
        return findFilterElements(root, selector, opts, true, elements.length);
    }
    // Performance optimization: If we don't have to traverse, just filter set.
    return findFilterElements(
        elements,
        selector,
        options,
        false,
        elements.length,
    );
}

export function select(
    selector: string | ((el: Element) => boolean),
    root: AnyNode | AnyNode[],
    options: Options = {},
    limit = Infinity,
): Element[] {
    if (typeof selector === "function") {
        return find(root, selector);
    }

    const [plain, filtered] = groupSelectors(parse(selector));

    const results: Element[][] = filtered.map((sel) =>
        findFilterElements(root, sel, options, true, limit),
    );

    // Plain selectors can be queried in a single go
    if (plain.length) {
        results.push(findElements(root, plain, options, limit));
    }

    if (results.length === 0) {
        return [];
    }

    // If there was only a single selector, just return the result
    if (results.length === 1) {
        return results[0];
    }

    // Sort results, filtering for duplicates
    return DomUtils.uniqueSort(results.reduce((a, b) => [...a, ...b]));
}

/**
 *
 * @param root Element(s) to search from.
 * @param selector Selector to look for.
 * @param options Options for querying.
 * @param queryForSelector Query multiple levels deep for the initial selector, even if it doesn't contain a traversal.
 */
function findFilterElements(
    root: AnyNode | AnyNode[],
    selector: Selector[],
    options: Options,
    queryForSelector: boolean,
    totalLimit: number,
): Element[] {
    const filterIndex = selector.findIndex(isFilter);
    const sub = selector.slice(0, filterIndex);
    const filter = selector[filterIndex] as CheerioSelector;
    // If we are at the end of the selector, we can limit the number of elements to retrieve.
    const partLimit =
        selector.length - 1 === filterIndex ? totalLimit : Infinity;

    /*
     * Set the number of elements to retrieve.
     * Eg. for :first, we only have to get a single element.
     */
    const limit = getLimit(filter.name, filter.data, partLimit);

    if (limit === 0) return [];

    /*
     * Skip `findElements` call if our selector starts with a positional
     * pseudo.
     */
    const elemsNoLimit =
        sub.length === 0 && !Array.isArray(root)
            ? DomUtils.getChildren(root).filter(DomUtils.isTag)
            : sub.length === 0
              ? (Array.isArray(root) ? root : [root]).filter(DomUtils.isTag)
              : queryForSelector || sub.some(isTraversal)
                ? findElements(root, [sub], options, limit)
                : filterElements(root, [sub], options);

    const elems = elemsNoLimit.slice(0, limit);

    let result = filterByPosition(filter.name, elems, filter.data, options);

    if (result.length === 0 || selector.length === filterIndex + 1) {
        return result;
    }

    const remainingSelector = selector.slice(filterIndex + 1);
    const remainingHasTraversal = remainingSelector.some(isTraversal);

    if (remainingHasTraversal) {
        if (isTraversal(remainingSelector[0])) {
            const { type } = remainingSelector[0];

            if (
                type === SelectorType.Sibling ||
                type === SelectorType.Adjacent
            ) {
                // If we have a sibling traversal, we need to also look at the siblings.
                result = prepareContext(result, DomUtils, true) as Element[];
            }

            // Avoid a traversal-first selector error.
            remainingSelector.unshift(UNIVERSAL_SELECTOR);
        }

        options = {
            ...options,
            // Avoid absolutizing the selector
            relativeSelector: false,
            /*
             * Add a custom root func, to make sure traversals don't match elements
             * that aren't a part of the considered tree.
             */
            rootFunc: (el: Element) => result.includes(el),
        };
    } else if (options.rootFunc && options.rootFunc !== boolbase.trueFunc) {
        options = { ...options, rootFunc: boolbase.trueFunc };
    }

    /*
     * If we have another filter, recursively call `findFilterElements`,
     * with the `recursive` flag disabled. We only have to look for more
     * elements when we see a traversal.
     *
     * Otherwise,
     */
    return remainingSelector.some(isFilter)
        ? findFilterElements(
              result,
              remainingSelector,
              options,
              false,
              totalLimit,
          )
        : remainingHasTraversal
          ? // Query existing elements to resolve traversal.
            findElements(result, [remainingSelector], options, totalLimit)
          : // If we don't have any more traversals, simply filter elements.
            filterElements(result, [remainingSelector], options);
}

interface CompiledQuery {
    (el: Element): boolean;
    shouldTestNextSiblings?: boolean;
}

function findElements(
    root: AnyNode | AnyNode[],
    sel: Selector[][],
    options: Options,
    limit: number,
): Element[] {
    // Fast path for simple selectors
    if (!Array.isArray(root)) {
        const simpleId = isSimpleIdSelector(sel);
        if (simpleId) {
            return fastFindById(root, simpleId, limit);
        }

        const simpleClass = isSimpleClassSelector(sel);
        if (simpleClass) {
            return fastFindByClass(root, simpleClass, limit);
        }

        const simpleTag = isSimpleTagSelector(sel);
        if (simpleTag) {
            return fastFindByTag(root, simpleTag, limit);
        }
    }

    // Check compiled selector cache
    let cacheMap = compiledSelectorCache.get(sel);
    if (!cacheMap) {
        cacheMap = new Map();
        compiledSelectorCache.set(sel, cacheMap);
    }

    // Create a safe cache key from options (excluding circular references)
    const cacheKey = getCacheKey(options);
    let query: CompiledQuery | undefined = cacheMap.get(cacheKey);

    if (!query) {
        query = compileToken<AnyNode, Element>(sel, options, root);
        cacheMap.set(cacheKey, query);
    }

    return find(root, query, limit);
}

/**
 * Create a cache key from options, avoiding circular references
 */
function getCacheKey(options: Options): string {
    // Only include non-circular options in the key
    const keyParts: string[] = [];

    if (options.xmlMode) keyParts.push("xml");
    if (options.relativeSelector !== undefined) {
        keyParts.push(`rel:${options.relativeSelector}`);
    }
    if (options.pseudos) {
        keyParts.push(`pseudo:${Object.keys(options.pseudos).join(",")}`);
    }
    if (options.adapter) keyParts.push("adapter");

    return keyParts.join("|") || "default";
}

function find(
    root: AnyNode | AnyNode[],
    query: CompiledQuery,
    limit = Infinity,
): Element[] {
    const elems = prepareContext<AnyNode, Element>(
        root,
        DomUtils,
        query.shouldTestNextSiblings,
    );

    return DomUtils.find(
        (node: AnyNode) => DomUtils.isTag(node) && query(node),
        elems,
        true,
        limit,
    ) as Element[];
}

function filterElements(
    elements: AnyNode | AnyNode[],
    sel: Selector[][],
    options: Options,
): Element[] {
    const els = (Array.isArray(elements) ? elements : [elements]).filter(
        DomUtils.isTag,
    );

    if (els.length === 0) return els;

    const query = compileToken<AnyNode, Element>(sel, options);
    return query === boolbase.trueFunc ? els : els.filter(query);
}

/**
 * Fast path for ID selectors
 */
function fastFindById(root: AnyNode, id: string, limit: number): Element[] {
    const results: Element[] = [];
    const stack: AnyNode[] = [root];

    while (stack.length > 0 && results.length < limit) {
        const node = stack.pop()!;

        if (DomUtils.isTag(node)) {
            const nodeId = node.attribs["id"];
            if (nodeId === id) {
                results.push(node);
                if (results.length >= limit) break;
            }
        }

        if (DomUtils.hasChildren(node)) {
            const children = DomUtils.getChildren(node);
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }
    }

    return results;
}

/**
 * Fast path for class selectors
 */
function fastFindByClass(
    root: AnyNode,
    className: string,
    limit: number,
): Element[] {
    const results: Element[] = [];
    const stack: AnyNode[] = [root];

    while (stack.length > 0 && results.length < limit) {
        const node = stack.pop()!;

        if (DomUtils.isTag(node)) {
            const classAttr = node.attribs["class"];
            if (classAttr) {
                const classes = classAttr.split(/\s+/);
                if (classes.includes(className)) {
                    results.push(node);
                    if (results.length >= limit) break;
                }
            }
        }

        if (DomUtils.hasChildren(node)) {
            const children = DomUtils.getChildren(node);
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }
    }

    return results;
}

/**
 * Fast path for tag selectors
 */
function fastFindByTag(
    root: AnyNode,
    tagName: string,
    limit: number,
): Element[] {
    const results: Element[] = [];
    const stack: AnyNode[] = [root];
    const lowerTag = tagName.toLowerCase();

    while (stack.length > 0 && results.length < limit) {
        const node = stack.pop()!;

        if (DomUtils.isTag(node) && node.name.toLowerCase() === lowerTag) {
            results.push(node);
            if (results.length >= limit) break;
        }

        if (DomUtils.hasChildren(node)) {
            const children = DomUtils.getChildren(node);
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }
    }

    return results;
}

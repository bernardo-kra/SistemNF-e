// Pure purchasing planner shared by the browser and the API. No persistence or authority.
export { conflicts, validGtin, mixedColors };
const normalized = (value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const unitKey = (value) => normalized(value).replace(/^(unidade|unidades|und|unid)$/, "un");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const emptyPurchasing = () => ({
    links: [],
    documents: [],
    receipts: [],
});
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && Number(value) >= minimum;
function fail(message) {
    throw new Error(message);
}
const sorted = (values) => values.map(normalized).sort();
export function extractProductIdentity(description) {
    const text = normalized(description);
    const attributes = {};
    const references = description
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ");
    const iphoneName = (number, suffix) => `iPhone ${number}${suffix ? ` ${suffix.replace(/\b\w/g, (c) => c.toUpperCase())}` : ""}`;
    const models = [];
    for (const match of references.matchAll(/iphone\s*(\d{1,2})(?:\s*(pro\s*max|pro|plus|mini))?\b/g)) {
        models.push(iphoneName(match[1], match[2]));
        let tail = references.slice((match.index || 0) + match[0].length);
        let abbreviated;
        while ((abbreviated = tail.match(/^\s*(?:\/|,|;|\be\b)\s*(?:iphone\s*)?(\d{1,2})(?:\s*(pro\s*max|pro|plus|mini))?\b/))) {
            models.push(iphoneName(abbreviated[1], abbreviated[2]));
            tail = tail.slice(abbreviated[0].length);
        }
    }
    const galaxy = [
        ...text.matchAll(/(?:samsung\s+)?galaxy\s+([asmzf]\s?\d{1,3}(?:\s+(?:ultra|plus|fe))?)/g),
    ].map((match) => `Galaxy ${match[1].toUpperCase().replace(/^([A-Z])\s+(\d)/, "$1$2")}`);
    const otherModels = [
        ...text.matchAll(/\b(moto|poco|redmi)\s+([a-z]?\d{1,3}[a-z]?(?:\s+(?:pro|plus|ultra|5g|4g))?)\b/g),
    ].map((match) => `${match[1].replace(/^./, (c) => c.toUpperCase())} ${match[2].toUpperCase()}`);
    if (models.length || galaxy.length || otherModels.length)
        attributes.compatibleModels = [
            ...new Set([...models, ...galaxy, ...otherModels]),
        ];
    if (/\bacrilic[ao]\b/.test(text))
        attributes.material = "Acrílico";
    else if (/\bsilicone\b/.test(text))
        attributes.material = "Silicone";
    if (/\bfosc[ao]\b/.test(text))
        attributes.finish = "Fosca";
    else if (/\btransparente\b/.test(text))
        attributes.finish = "Transparente";
    const color = text.match(/\b(preta?|branca?|azul|vermelh[ao]|verde|rosa|rox[ao]|amarel[ao]|cinza|dourad[ao]|prat[ae])\b/);
    if (color)
        attributes.color = color[1].replace(/^./, (c) => c.toUpperCase());
    if (/\bsem\s+mag\s*safe\b/.test(text))
        attributes.magsafe = false;
    else if (/\bmag\s*safe\b/.test(text))
        attributes.magsafe = true;
    if (/\bprotecao\s+(?:de\s+)?lente\b/.test(text))
        attributes.lensProtection = true;
    if (/\bborda\s+colorida\b/.test(text))
        attributes.border = "Colorida; cor não informada";
    const connectors = [
        ...text.matchAll(/\busb\s*([abc])\b|\b(lightning|micro\s*usb|hdmi|vga|displayport)\b/g),
    ].map((match) => match[1]
        ? `USB-${match[1].toUpperCase()}`
        : match[2].replace(/\b\w/g, (c) => c.toUpperCase()));
    if (connectors.length)
        attributes.connectors = connectors;
    const length = text.match(/\b(\d+(?: \d+)?)\s*(metros?|m)\b/);
    if (length)
        attributes.lengthMeters = Number(length[1].replace(" ", "."));
    const power = text.match(/\b(\d+)\s*w\b/);
    if (power)
        attributes.powerWatts = Number(power[1]);
    let category = "Importados";
    let name = description.trim().replace(/\s+/g, " ");
    if (/\bcapa\b/.test(text)) {
        category = "Capas";
        name = [
            "Capa",
            attributes.material === "Acrílico"
                ? "acrílica"
                : attributes.material?.toLowerCase(),
            attributes.magsafe === true ? "MagSafe" : "",
            attributes.compatibleModels?.length
                ? `— ${attributes.compatibleModels.join(" / ")}`
                : "",
        ]
            .filter(Boolean)
            .join(" ");
    }
    else if (/\bcabo\b/.test(text)) {
        category = "Cabos";
        name = [
            "Cabo",
            connectors.join(" para "),
            attributes.lengthMeters ? `· ${attributes.lengthMeters} m` : "",
            attributes.powerWatts ? `· ${attributes.powerWatts} W` : "",
        ]
            .filter(Boolean)
            .join(" ");
    }
    else if (/\badaptador\b/.test(text)) {
        category = "Adaptadores";
        if (connectors.length)
            name = `Adaptador ${connectors.join(" para ")}`;
    }
    return { name, category, attributes };
}
function conflicts(current, baseline, requireKnown = false) {
    for (const key of Object.keys(baseline)) {
        const old = baseline[key];
        const value = current[key];
        if (value === undefined) {
            if (requireKnown && old !== undefined)
                return true;
            continue;
        }
        if (old === undefined)
            continue;
        if (Array.isArray(old) && Array.isArray(value)) {
            if (!same(sorted(old), sorted(value)))
                return true;
        }
        else if (typeof old === "string" && typeof value === "string") {
            if (normalized(old) !== normalized(value))
                return true;
        }
        else if (old !== value)
            return true;
    }
    return false;
}
const mixedColors = (description) => /\b(?:cores?\s+sortid[ao]s?|sortid[ao]s?)\b/.test(normalized(description));
const validGtin = (value) => value && /^(?:\d{8}|\d{12,14})$/.test(value) && !/^0+$/.test(value)
    ? value
    : undefined;
export function buildPurchasePlan(state, document) {
    const purchasing = state.purchasing || emptyPurchasing();
    const byCode = new Map();
    for (const link of purchasing.links) {
        if (link.supplierId !== document.supplierId)
            continue;
        const found = byCode.get(link.supplierCode) || [];
        found.push(link);
        byCode.set(link.supplierCode, found);
    }
    const products = new Map(state.products.map((product) => [product.id, product]));
    const identities = state.products.map((product) => ({
        product,
        identity: extractProductIdentity(product.name),
    }));
    return {
        lines: document.items.map((source) => {
            const identity = extractProductIdentity(source.description);
            const base = {
                source,
                ...identity,
                candidates: [],
                conversion: 1,
            };
            const links = byCode.get(source.code) || [];
            const link = links.find((candidate) => unitKey(candidate.unit) === unitKey(source.unit)) || links[0];
            if (mixedColors(source.description))
                return {
                    ...base,
                    resolution: "review",
                    reason: "Cores sortidas: confira a distribuição antes de receber.",
                };
            if (link) {
                const product = products.get(link.productId);
                if (!product)
                    return {
                        ...base,
                        resolution: "review",
                        reason: "O produto do vínculo não está disponível.",
                    };
                const changed = normalized(link.description) !== normalized(source.description);
                const currentProductAttributes = product.attributes || extractProductIdentity(product.name).attributes;
                const incompatible = unitKey(source.unit) !== unitKey(link.unit) ||
                    conflicts(identity.attributes, link.attributes, changed) ||
                    conflicts(identity.attributes, currentProductAttributes) ||
                    (validGtin(source.gtin) && link.gtin && source.gtin !== link.gtin);
                if (incompatible)
                    return {
                        ...base,
                        resolution: "review",
                        candidates: [product.id],
                        reason: "Modelo, característica, GTIN ou embalagem mudou; confira o vínculo.",
                    };
                return {
                    ...base,
                    resolution: "known",
                    productId: product.id,
                    conversion: link.conversion,
                    reason: "Vínculo confirmado com este fornecedor.",
                };
            }
            const gtin = validGtin(source.gtin);
            if (gtin &&
                identities.some(({ product, identity: productIdentity }) => product.gtin === gtin &&
                    conflicts(identity.attributes, product.attributes || productIdentity.attributes))) {
                return {
                    ...base,
                    resolution: "review",
                    reason: "O GTIN coincide com um produto de características incompatíveis. Confira a origem antes de vincular ou criar.",
                    candidates: identities
                        .filter(({ product }) => product.gtin === gtin)
                        .map(({ product }) => product.id),
                };
            }
            const candidates = identities
                .filter(({ product, identity: productIdentity }) => {
                const attributes = product.attributes || productIdentity.attributes;
                if (conflicts(identity.attributes, attributes))
                    return false;
                if (gtin && product.gtin === gtin)
                    return true;
                if (identity.category === "Importados")
                    return normalized(product.name) === normalized(source.description);
                if (productIdentity.category !== identity.category &&
                    normalized(product.category) !== normalized(identity.category))
                    return false;
                if (identity.category === "Capas")
                    return Boolean(identity.attributes.compatibleModels?.length &&
                        attributes.compatibleModels?.some((model) => identity.attributes.compatibleModels
                            ?.map(normalized)
                            .includes(normalized(model))));
                if (identity.attributes.connectors?.length)
                    return Boolean(attributes.connectors?.length &&
                        same(sorted(attributes.connectors), sorted(identity.attributes.connectors)));
                return normalized(product.name) === normalized(source.description);
            })
                .map(({ product }) => product.id);
            const identified = identity.category === "Capas"
                ? Boolean(identity.attributes.compatibleModels?.length)
                : identity.category === "Cabos" || identity.category === "Adaptadores"
                    ? Boolean(identity.attributes.connectors?.length)
                    : normalized(source.description).split(" ").length >= 2;
            const packaging = !["un", "pc", "peca"].includes(unitKey(source.unit));
            return {
                ...base,
                candidates,
                resolution: candidates.length || !identified || packaging
                    ? "review"
                    : "new",
                reason: candidates.length
                    ? "Confira uma possível correspondência no catálogo."
                    : packaging
                        ? "Informe a conversão da embalagem antes de receber."
                        : identified
                            ? "Novo produto identificado; cadastro proposto em lote."
                            : "Descrição insuficiente para identificar o produto.",
            };
        }),
    };
}

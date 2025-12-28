"use strict";

const galleryEl = document.getElementById("gallery");
const viewerEl = document.getElementById("viewer");
const searchEl = document.getElementById("search");

const backBtn = document.getElementById("back");

// Mapping DOM (hérité) : nav-next = bouton visuel GAUCHE ; nav-prev = bouton visuel DROITE
const navLeftBtn = document.getElementById("nav-next");  // gauche
const navRightBtn = document.getElementById("nav-prev"); // droite

const viewerTitle = document.getElementById("viewer-title");
const viewerImage = document.getElementById("viewer-image");
const viewerDate = document.getElementById("viewer-date");
const viewerDesc = document.getElementById("viewer-desc");

let IMAGES = [];
let COLLECTIONS = [];

let CURRENT_IMAGE = null;
let isDescExpanded = false;

/* UI state */
let sortMode = "date_desc"; // date_desc | date_asc | collections
let activeCollectionId = null; // filtre collection (clic sur titre de collection / lien viewer)
let currentQuery = "";

/* Ordre actuel visible de la galerie (pilote navigation viewer) */
let GALLERY_ORDER_IDS = [];

/* UI injected */
let sortSelectEl = null;
let clearFilterBtn = null;
let searchClearBtn = null;

// Viewer collection link (plain, underline only name span)
let viewerCollectionLink = null;

/* ---------------- Utils ---------------- */

function normalize(str) {
  return (str ?? "").toString().trim().toLowerCase();
}

function parseDateISO(d) {
  const t = Date.parse(d);
  return Number.isNaN(t) ? 0 : t;
}

function formatDateFR(isoDate) {
  const t = parseDateISO(isoDate);
  if (!t) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(t));
}

function setViewerOpen(isOpen) {
  viewerEl.classList.toggle("active", isOpen);
  viewerEl.setAttribute("aria-hidden", String(!isOpen));
}

/* ---------------- Back button UI: "← Retour" ---------------- */

function ensureBackButtonLabel() {
  // Remplace le contenu du bouton pour avoir flèche + "Retour"
  backBtn.innerHTML = `<span class="back-icon">←</span><span>Retour</span>`;
}

/* ---------------- Dissuasion basique ---------------- */

function hardenMediaInteractions() {
  document.addEventListener("dragstart", (e) => {
    if (e.target?.tagName === "IMG") e.preventDefault();
  }, { capture: true });

  document.addEventListener("contextmenu", (e) => {
    if (e.target?.tagName === "IMG") e.preventDefault();
  }, { capture: true });

  document.addEventListener("selectstart", (e) => {
    if (e.target?.tagName === "IMG") e.preventDefault();
  }, { capture: true });
}

/* ---------------- Controls UI (tri + tout) ---------------- */

function ensureControlsUI() {
  const header = document.querySelector("header");
  if (!header) return;

  let controls = header.querySelector(".controls");
  if (!controls) {
    controls = document.createElement("div");
    controls.className = "controls";

    const h1 = header.querySelector("h1");
    if (h1 && h1.nextSibling) header.insertBefore(controls, h1.nextSibling);
    else header.appendChild(controls);
  }

  if (!sortSelectEl) {
    sortSelectEl = document.createElement("select");
    sortSelectEl.className = "sort-select";
    sortSelectEl.setAttribute("aria-label", "Ordre des images");
    sortSelectEl.innerHTML = `
      <option value="date_desc">Date décroissante</option>
      <option value="date_asc">Date croissante</option>
      <option value="collections">Par collection</option>
    `;
    sortSelectEl.value = sortMode;

    sortSelectEl.addEventListener("change", () => {
      sortMode = sortSelectEl.value;
      renderFromState();
      updateViewerNavButtons();
    });

    controls.appendChild(sortSelectEl);
  }

  if (!clearFilterBtn) {
    clearFilterBtn = document.createElement("button");
    clearFilterBtn.type = "button";
    clearFilterBtn.className = "filter-clear";
    clearFilterBtn.textContent = "Tout";
    clearFilterBtn.addEventListener("click", () => {
      activeCollectionId = null;
      updateClearFilterVisibility();
      renderFromState();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    controls.appendChild(clearFilterBtn);
  }

  updateClearFilterVisibility();
}

function updateClearFilterVisibility() {
  if (!clearFilterBtn) return;
  clearFilterBtn.classList.toggle("is-visible", !!activeCollectionId);
}

/* ---------------- Search UI (wrap + clear) ---------------- */

function ensureSearchClearUI() {
  const header = document.querySelector("header");
  const controls = header?.querySelector(".controls");
  if (!controls) return;

  if (searchEl.closest(".search-wrap")) {
    const wrap = searchEl.closest(".search-wrap");
    if (wrap.parentElement !== controls) controls.insertBefore(wrap, controls.firstChild);
    searchClearBtn = wrap.querySelector(".search-clear");
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "search-wrap";

  searchEl.parentNode.insertBefore(wrap, searchEl);
  wrap.appendChild(searchEl);
  controls.insertBefore(wrap, controls.firstChild);

  searchClearBtn = document.createElement("button");
  searchClearBtn.type = "button";
  searchClearBtn.className = "search-clear";
  searchClearBtn.setAttribute("aria-label", "Effacer la recherche");
  searchClearBtn.textContent = "×";
  wrap.appendChild(searchClearBtn);

  const refreshVisibility = () => {
    searchClearBtn.classList.toggle("is-visible", (searchEl.value || "").length > 0);
  };

  searchClearBtn.addEventListener("click", () => {
    searchEl.value = "";
    refreshVisibility();
    currentQuery = "";
    renderFromState();
    searchEl.focus();
  });

  searchEl.addEventListener("input", refreshVisibility);
  refreshVisibility();
}

/* ---------------- Data helpers ---------------- */

function getImageById(id) {
  return IMAGES.find((i) => i.id === id) || null;
}

function getCollectionById(id) {
  return COLLECTIONS.find((c) => c.id === id) || null;
}

function getCollectionNameById(id) {
  const c = getCollectionById(id);
  return c?.name || c?.title || "Sans nom";
}

/* ---------------- Navigation helper (ordre de la galerie) ---------------- */

function getGalleryIndexById(id) {
  return GALLERY_ORDER_IDS.indexOf(id);
}

function goNextInGalleryOrder() {
  if (!CURRENT_IMAGE) return;
  const idx = getGalleryIndexById(CURRENT_IMAGE.id);
  if (idx < 0 || idx >= GALLERY_ORDER_IDS.length - 1) return;
  openViewer(GALLERY_ORDER_IDS[idx + 1]);
}

function goPrevInGalleryOrder() {
  if (!CURRENT_IMAGE) return;
  const idx = getGalleryIndexById(CURRENT_IMAGE.id);
  if (idx <= 0) return;
  openViewer(GALLERY_ORDER_IDS[idx - 1]);
}

function updateViewerNavButtons() {
  if (!CURRENT_IMAGE) {
    navLeftBtn.disabled = true;
    navRightBtn.disabled = true;
    return;
  }

  const idx = getGalleryIndexById(CURRENT_IMAGE.id);
  if (idx < 0) {
    navLeftBtn.disabled = true;
    navRightBtn.disabled = true;
    return;
  }

  // Flèches standard : gauche = précédent ; droite = suivant
  navLeftBtn.disabled = idx <= 0;
  navRightBtn.disabled = idx >= GALLERY_ORDER_IDS.length - 1;
}

/* ---------------- Gallery ordering (state -> list) ---------------- */

function buildFilteredImages() {
  const q = normalize(currentQuery);
  let list = IMAGES;

  if (activeCollectionId) {
    list = list.filter((img) => img.collectionId === activeCollectionId);
  }

  if (q) {
    list = list.filter((img) => {
      const nameMatch = normalize(img.name).includes(q);
      const tags = Array.isArray(img.tags) ? img.tags : [];
      const tagMatch = tags.some((t) => normalize(t).includes(q));
      return nameMatch || tagMatch;
    });
  }

  return list;
}

function sortImagesByMode(list) {
  const copy = [...list];

  if (sortMode === "date_asc") {
    copy.sort((a, b) => parseDateISO(a.date) - parseDateISO(b.date));
    return copy;
  }

  if (sortMode === "date_desc") {
    copy.sort((a, b) => parseDateISO(b.date) - parseDateISO(a.date));
    return copy;
  }

  // mode collections : tri interne date_desc
  copy.sort((a, b) => parseDateISO(b.date) - parseDateISO(a.date));
  return copy;
}

/* ---------------- Gallery rendering ---------------- */

function createGalleryCard(img) {
  const card = document.createElement("div");
  card.className = "card fade-in";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", img.name);

  const im = document.createElement("img");
  im.src = img.src;
  im.alt = "";
  im.draggable = false;
  im.loading = "lazy";
  im.decoding = "async";

  card.appendChild(im);

  card.addEventListener("click", () => openViewer(img.id));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openViewer(img.id);
    }
  });

  return card;
}

function fadeInElement(el, index) {
  const delay = Math.min(22 * index, 600);
  window.setTimeout(() => el.classList.add("is-visible"), delay);
}

function renderGalleryFlat(imagesSorted) {
  galleryEl.classList.remove("gallery-collections");
  galleryEl.classList.add("gallery");
  galleryEl.innerHTML = "";

  GALLERY_ORDER_IDS = imagesSorted.map((i) => i.id);

  imagesSorted.forEach((img, i) => {
    const card = createGalleryCard(img);
    galleryEl.appendChild(card);
    fadeInElement(card, i);
  });
}

function renderGalleryByCollections(imagesSorted) {
  // group by collectionId (or null)
  const byCol = new Map();
  for (const img of imagesSorted) {
    const key = img.collectionId || null; // null => sans collection
    if (!byCol.has(key)) byCol.set(key, []);
    byCol.get(key).push(img);
  }

  // build sections with latest date for ordering collections
  const sections = [];
  for (const [collectionId, imgs] of byCol.entries()) {
    const latest = imgs.length ? parseDateISO(imgs[0].date) : 0;
    sections.push({ collectionId, latest, images: imgs });
  }

  // Sort:
  // - collections récentes en haut
  // - sans collection à la fin
  sections.sort((a, b) => {
    const aNone = a.collectionId == null;
    const bNone = b.collectionId == null;
    if (aNone && !bNone) return 1;
    if (!aNone && bNone) return -1;
    return b.latest - a.latest;
  });

  galleryEl.classList.remove("gallery");
  galleryEl.classList.add("gallery-collections");
  galleryEl.innerHTML = "";

  // build GALLERY_ORDER_IDS in visible order
  GALLERY_ORDER_IDS = [];
  let globalIndex = 0;

  for (const sec of sections) {
    const sectionEl = document.createElement("div");

    // Title: underline (name) + clickable -> filter
    if (sec.collectionId != null) {
      const name = getCollectionNameById(sec.collectionId);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "collection-title";
      btn.textContent = name;

      // underline + no box (inline style)
      btn.style.background = "transparent";
      btn.style.border = "0";
      btn.style.padding = "0";
      btn.style.margin = "0 0 10px";
      btn.style.color = "inherit";
      btn.style.cursor = "pointer";
      btn.style.textDecoration = "underline";
      btn.style.textAlign = "left";
      btn.style.width = "fit-content";
      btn.style.display = "inline";

      btn.addEventListener("click", () => {
        activeCollectionId = sec.collectionId;
        updateClearFilterVisibility();
        renderFromState();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      sectionEl.appendChild(btn);
    } else {
      // Sans collection: non cliquable, non souligné
      const title = document.createElement("div");
      title.className = "collection-title";
      title.textContent = "Sans collection";
      title.style.marginBottom = "10px";
      sectionEl.appendChild(title);
    }

    const grid = document.createElement("div");
    grid.className = "collection-grid";
    sectionEl.appendChild(grid);

    galleryEl.appendChild(sectionEl);

    for (const img of sec.images) {
      GALLERY_ORDER_IDS.push(img.id);

      const card = createGalleryCard(img);
      grid.appendChild(card);
      fadeInElement(card, globalIndex);
      globalIndex += 1;
    }
  }
}

function renderFromState() {
  updateClearFilterVisibility();

  const filtered = buildFilteredImages();
  const sorted = sortImagesByMode(filtered);

  if (sortMode === "collections") renderGalleryByCollections(sorted);
  else renderGalleryFlat(sorted);

  updateViewerNavButtons();
}

/* ---------------- Halo ---------------- */

function extractAverageColor(img) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d", { willReadFrequently: true });
  c.width = c.height = 50;

  ctx.drawImage(img, 0, 0, 50, 50);
  const d = ctx.getImageData(0, 0, 50, 50).data;

  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }

  const n = d.length / 4;
  return { r: (r / n) | 0, g: (g / n) | 0, b: (b / n) | 0 };
}

function applyAmbientLight(img) {
  const ambient = document.getElementById("ambient-light");
  if (!ambient) return;

  ambient.style.opacity = "0";
  img.addEventListener("load", () => {
    try {
      const { r, g, b } = extractAverageColor(img);
      ambient.style.background = `rgb(${r}, ${g}, ${b})`;
      ambient.style.opacity = "0.28";
    } catch {}
  }, { once: true });
}

/* ---------------- Viewer: "Collection " + underline only the name ---------------- */

function ensureViewerCollectionLink() {
  if (viewerCollectionLink) return;

  viewerCollectionLink = document.createElement("button");
  viewerCollectionLink.type = "button";
  viewerCollectionLink.id = "viewer-collection-link";

  // no underline on the whole button
  viewerCollectionLink.style.background = "transparent";
  viewerCollectionLink.style.border = "0";
  viewerCollectionLink.style.padding = "0";
  viewerCollectionLink.style.margin = "6px 0 10px";
  viewerCollectionLink.style.color = "inherit";
  viewerCollectionLink.style.cursor = "pointer";
  viewerCollectionLink.style.fontSize = "0.95rem";
  viewerCollectionLink.style.width = "fit-content";
  viewerCollectionLink.style.textAlign = "left";

  // Place under date
  viewerDate.insertAdjacentElement("afterend", viewerCollectionLink);

  viewerCollectionLink.addEventListener("click", () => {
    if (!CURRENT_IMAGE?.collectionId) return;

    activeCollectionId = CURRENT_IMAGE.collectionId;

    setViewerOpen(false);
    CURRENT_IMAGE = null;

    updateClearFilterVisibility();
    renderFromState();

    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function setViewerCollectionLink(collectionId) {
  if (!viewerCollectionLink) return;

  if (!collectionId) {
    viewerCollectionLink.style.display = "none";
    viewerCollectionLink.innerHTML = "";
    return;
  }

  const name = getCollectionNameById(collectionId);

  // "Collection " not underlined, only name underlined
  viewerCollectionLink.style.display = "inline";
  viewerCollectionLink.innerHTML = `Collection <span class="collection-name" style="text-decoration:underline;">${escapeHtml(name)}</span>`;
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------------- Description (Plus / Moins) ---------------- */

function ensureDescUI() {
  if (viewerDesc.closest(".desc-wrap")) return;

  const wrap = document.createElement("div");
  wrap.className = "desc-wrap";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "desc-toggle";
  toggle.id = "desc-toggle";
  toggle.textContent = "Plus";

  viewerDesc.parentNode.insertBefore(wrap, viewerDesc);
  wrap.appendChild(viewerDesc);
  wrap.appendChild(toggle);

  toggle.addEventListener("click", () => {
    isDescExpanded = !isDescExpanded;
    viewerDesc.classList.toggle("expanded", isDescExpanded);
    toggle.textContent = isDescExpanded ? "Moins" : "Plus";
  });
}

function setDescription(text) {
  ensureDescUI();

  isDescExpanded = false;
  viewerDesc.classList.remove("expanded");
  viewerDesc.textContent = text || "";

  const toggle = document.getElementById("desc-toggle");
  requestAnimationFrame(() => {
    const needsToggle = viewerDesc.scrollHeight > viewerDesc.clientHeight + 1;
    toggle.style.display = needsToggle ? "inline-flex" : "none";
    toggle.textContent = "Plus";
  });
}

/* ---------------- Viewer open ---------------- */

function openViewer(id) {
  const img = getImageById(id);
  if (!img) return;

  CURRENT_IMAGE = img;
  document.activeElement?.blur?.();

  ensureViewerCollectionLink();

  // anti-flash
  viewerImage.classList.remove("is-ready");
  viewerImage.removeAttribute("src");
  viewerImage.draggable = false;

  viewerImage.addEventListener("load", () => {
    viewerImage.classList.add("is-ready");
  }, { once: true });

  applyAmbientLight(viewerImage);

  viewerImage.src = img.src;
  viewerImage.alt = img.name;

  viewerTitle.textContent = img.name;
  viewerDate.textContent = formatDateFR(img.date);
  setDescription(img.description);

  setViewerCollectionLink(img.collectionId);

  updateViewerNavButtons();
  setViewerOpen(true);
}

/* ---------------- Swipe (inversé) ----------------
 * Swipe gauche -> SUIVANT
 * Swipe droite -> PRÉCÉDENT
-------------------------------------------------- */

function setupSwipe() {
  const zone = document.querySelector(".image-wrapper");
  if (!zone) return;

  let sx = 0, sy = 0, active = false;

  zone.addEventListener("pointerdown", (e) => {
    if (!viewerEl.classList.contains("active")) return;
    active = true;
    sx = e.clientX;
    sy = e.clientY;
  });

  zone.addEventListener("pointerup", (e) => {
    if (!active) return;
    active = false;

    const dx = e.clientX - sx;
    const dy = e.clientY - sy;

    if (Math.abs(dx) < 45 || Math.abs(dy) > 70) return;

    // INVERSE : gauche => suivant ; droite => précédent
    if (dx < 0) goNextInGalleryOrder();
    else goPrevInGalleryOrder();
  });

  zone.addEventListener("pointercancel", () => { active = false; });
}

/* ---------------- Load ---------------- */

async function loadData() {
  const [i, c] = await Promise.all([
    fetch("./images.json", { cache: "no-store" }),
    fetch("./collections.json", { cache: "no-store" })
  ]);

  IMAGES = await i.json();
  COLLECTIONS = await c.json();

  sortMode = "date_desc";
  if (sortSelectEl) sortSelectEl.value = sortMode;

  renderFromState();
}

/* ---------------- Events ---------------- */

backBtn.onclick = () => {
  setViewerOpen(false);
  CURRENT_IMAGE = null;
};

// Flèches standard : gauche précédent, droite suivant
navLeftBtn.onclick = goPrevInGalleryOrder;
navRightBtn.onclick = goNextInGalleryOrder;

document.onkeydown = (e) => {
  if (!viewerEl.classList.contains("active")) return;

  if (e.key === "Escape") {
    setViewerOpen(false);
    CURRENT_IMAGE = null;
  }

  if (e.key === "ArrowLeft") goPrevInGalleryOrder();
  if (e.key === "ArrowRight") goNextInGalleryOrder();
};

searchEl.oninput = (e) => {
  currentQuery = e.target.value || "";
  renderFromState();
};

/* Init */
hardenMediaInteractions();
ensureBackButtonLabel();
ensureControlsUI();
ensureSearchClearUI();
setupSwipe();
loadData().catch(() => {
  galleryEl.textContent = "Erreur de chargement.";
});

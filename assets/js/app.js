/* Config values mapped from implementation plan */
const Config = {
  listPageSize: 1000,
  previewTextMaxBytes: 262144, // 256 KiB
  multipartThresholdBytes: 10485760, // 10 MiB
  multipartPartSizeBytes: 8388608, // 8 MiB
  multipartConcurrency: 4,
  downloadConcurrency: 4,
  retryBaseMs: 500,
  retryMaxAttempts: 5,
  deleteBatchSize: 1000,
  allowedDirNamePattern: /^[A-Za-z0-9._-]+$/,
  uiFocusOutlineColor: "#E0E1DD"
};

/* State model (in-memory only) */
const SessionState = {
  accessKeyId: "",
  secretAccessKey: "",
  region: "",
  bucket: "",
  sessionWarnings: [],
  connected: false
};

const NavigationState = {
  currentPrefix: "",
  breadcrumbs: [] // { label, prefix }
};

const ListingState = {
  objects: [], // { key, size, lastModified }
  prefixes: [], // { prefix }
  nextContinuationToken: null,
  isLoading: false,
  lastRefreshedAt: null
};

const SelectionState = {
  selectedKeys: new Set(),
  selectedPrefixes: new Set(),
  selectAllPage: false
};

const FilterState = {
  text: "",
  active: false
};

const OperationRegistry = {
  uploads: new Map(), // id -> { fileName, key, totalBytes, uploadedBytes, status, parts[], abortController, uploadId, managedUpload }
  deletes: new Map(), // id -> { type: "single"|"bulkPrefix", keysTotal, keysDeleted, keysFailed[], status }
  listings: { status: "idle", pageCount: 0 },
  moves: new Map() // id -> { keysTotal, keysMoved, keysFailed[], status }
};

const UIState = {
  modals: {
    upload: false,
    preview: false,
    createDir: false,
    confirmDelete: false,
    deleteDir: false,
    info: false,
    changeBucket: false,
    folderConfirm: false,
    movePicker: false,
    moveConfirm: false,
    moveProgress: false,
    downloadProgress: false
  },
  preview: {
    key: "",
    type: "unknown",
    truncated: false,
    content: null,
    blobUrl: null,
    contentType: ""
  },
  toasts: [],
  lastFocusedElementId: null
};

const MoveState = {
  pickerPrefix: "",
  destPrefix: "",
  conflicts: [],
  inProgress: false
};

// State for multi-download/zip process
const DownloadState = {
  inProgress: false,
  zip: null, // JSZip instance
  keysTotal: 0,
  keysFetched: 0,
  failures: [] // { key, code, msg }[]
};

// AWS S3 client
/** @type {AWS.S3 | null} */
let s3 = null;

// Utility helpers
const el = (id) => document.getElementById(id);

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

function createFolderIcon() {
  const icon = document.createElement("span");
  icon.className = "folder-icon";
  icon.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M507.011,116.239c-5.006-5.425-12.726-7.421-19.738-5.101L133.065,228.115c-10.252,3.412-18.56,11.046-22.774,20.992l-57.61,135.794l-2.636-190.3L385.018,82.307l-0.7-50.829c-0.05-3.608-1.826-6.969-4.777-9.058c-2.95-2.09-6.704-2.618-10.124-1.467L183.161,83.714c-4.051,1.374-8.529,0.342-11.566-2.687l-35.253-35.066c-3.02-2.994-7.481-4.052-11.516-2.704L7.729,82.137c-4.666,1.544-7.796,5.937-7.728,10.858l5.357,387.533c0.052,3.583,1.808,6.934,4.743,9.024c2.925,2.082,6.678,2.653,10.099,1.518l390.356-128.979c3.071-1.032,5.561-3.318,6.833-6.304l93.119-219.454C513.391,129.528,512.026,121.671,507.011,116.239z"
        fill="currentColor"
      />
    </svg>
  `;
  return icon;
}

function formatPrefixLabel(prefix, basePrefix) {
  const label = String(prefix || "").substring(String(basePrefix || "").length) || prefix || "";
  return label.endsWith("/") ? label.slice(0, -1) : label;
}

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0,
    n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}

function showToast(title, message, opts = { autoDismissMs: 8000 }) {
  const container = document.querySelector(".toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  let dismissTimer = null;
  const removeToast = () => {
    if (!toast.isConnected) return;
    toast.classList.add("toast--leave");
    toast.addEventListener(
      "animationend",
      () => {
        toast.remove();
      },
      { once: true }
    );
  };
  const btn = document.createElement("button");
  btn.textContent = "×";
  btn.setAttribute("aria-label", "Dismiss");
  btn.addEventListener("click", () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    removeToast();
  });
  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = title;
  const msg = document.createElement("div");
  msg.innerHTML = escapeHTML(message);
  toast.appendChild(btn);
  toast.appendChild(titleEl);
  toast.appendChild(msg);
  container.appendChild(toast);
  if (opts.autoDismissMs && opts.autoDismissMs > 0) {
    dismissTimer = setTimeout(removeToast, opts.autoDismissMs);
  }
}

function setInlineBanner(id, text, type = "error") {
  const banner = el(id);
  banner.textContent = text;
  banner.className = `inline-banner ${type}`;
  banner.hidden = !text;
}

function clearInlineBanner(id) {
  const banner = el(id);
  banner.textContent = "";
  banner.hidden = true;
}

// Modal controls and focus management
function openModal(overlayId, modalFocusId) {
  const overlay = el(overlayId);
  UIState.lastFocusedElementId = document.activeElement?.id || null;
  overlay.classList.add("active");
  overlay.addEventListener("click", overlayClickToCloseHandler);
  document.addEventListener("keydown", escToCloseHandler);
  trapFocus(overlay);
  const focusEl = modalFocusId ? el(modalFocusId) : overlay.querySelector(".modal");
  if (focusEl) focusEl.focus();
}

function closeModal(overlayId) {
  const overlay = el(overlayId);
  overlay.classList.remove("active");
  overlay.removeEventListener("click", overlayClickToCloseHandler);
  document.removeEventListener("keydown", escToCloseHandler);
  untrapFocus(overlay);
  const last = UIState.lastFocusedElementId ? el(UIState.lastFocusedElementId) : null;
  if (last) last.focus();
}

function openInfoPanel() {
  const overlay = el("infoModalOverlay");
  const infoFabEl = el("infoFab");
  if (infoFabEl) infoFabEl.hidden = true;
  if (overlay) overlay.classList.remove("is-closing");
  UIState.modals.info = true;
  openModal("infoModalOverlay", "infoModal");
}

function closeInfoPanel() {
  const overlay = el("infoModalOverlay");
  if (!overlay) return;
  overlay.classList.add("is-closing");
  setTimeout(() => {
    overlay.classList.remove("is-closing");
    closeModal("infoModalOverlay");
    const infoFabEl = el("infoFab");
    if (infoFabEl) infoFabEl.hidden = false;
  }, 220);
}

function openFolderConfirmModal(count) {
  const body = el("folderConfirmBody");
  if (body) {
    body.textContent = `Upload ${count} files from this folder?`;
  }
  UIState.modals.folderConfirm = true;
  openModal("folderConfirmModalOverlay", "folderConfirmModal");
}

function closeFolderConfirmModal() {
  UIState.modals.folderConfirm = false;
  closeModal("folderConfirmModalOverlay");
}

function setAccountMenuVisible(isVisible) {
  const mobileMenuBtn = el("mobileMenuBtn");
  if (mobileMenuBtn) mobileMenuBtn.hidden = !isVisible;
}

function openMobileMenu() {
  const overlay = el("mobileMenuOverlay");
  if (overlay) overlay.classList.add("active");
}

function closeMobileMenu() {
  const overlay = el("mobileMenuOverlay");
  if (overlay) overlay.classList.remove("active");
}

async function changeBucketFlow() {
  const input = el("changeBucketInput");
  const error = el("changeBucketError");
  if (!input || !error) return;
  const nextBucket = input.value.trim();
  if (!isValidBucketName(nextBucket)) {
    error.textContent = "Bucket format looks invalid.";
    error.hidden = false;
    return;
  }
  error.textContent = "";
  error.hidden = true;
  try {
    const params = { Bucket: nextBucket, Delimiter: "/", MaxKeys: 1 };
    await s3.listObjectsV2(params).promise();

    SessionState.bucket = nextBucket;
    el("connBucket").textContent = nextBucket;
    el("bucket").value = nextBucket;
    UIState.modals.changeBucket = false;
    closeModal("changeBucketModalOverlay");
    navigateToPrefix("");
    showToast("Bucket Updated", `Now browsing ${escapeHTML(nextBucket)}.`);
  } catch (err) {
    const msg = err?.message || String(err);
    error.textContent = msg;
    error.hidden = false;
    showToast("Bucket Update Failed", msg, { autoDismissMs: 12000 });
  }
}

function openChangeBucketModal() {
  const input = el("changeBucketInput");
  const error = el("changeBucketError");
  if (input) input.value = SessionState.bucket || "";
  if (error) {
    error.textContent = "";
    error.hidden = true;
  }
  UIState.modals.changeBucket = true;
  openModal("changeBucketModalOverlay", "changeBucketModal");
}

function overlayClickToCloseHandler(e) {
  if (e.target.classList.contains("modal-overlay")) {
    // Find which overlay is clicked
    if (e.target.id === "uploadModalOverlay") {
      UIState.modals.upload = false;
      closeModal("uploadModalOverlay");
    }
    if (e.target.id === "previewModalOverlay") {
      UIState.modals.preview = false;
      cleanupPreview();
      closeModal("previewModalOverlay");
    }
    if (e.target.id === "createDirModalOverlay") {
      UIState.modals.createDir = false;
      closeModal("createDirModalOverlay");
    }
    if (e.target.id === "confirmDeleteModalOverlay") {
      UIState.modals.confirmDelete = false;
      closeModal("confirmDeleteModalOverlay");
    }
    if (e.target.id === "folderConfirmModalOverlay") {
      UIState.modals.folderConfirm = false;
      closeModal("folderConfirmModalOverlay");
    }
    if (e.target.id === "deleteDirModalOverlay") {
      UIState.modals.deleteDir = false;
      closeModal("deleteDirModalOverlay");
    }
    if (e.target.id === "changeBucketModalOverlay") {
      UIState.modals.changeBucket = false;
      closeModal("changeBucketModalOverlay");
    }
    if (e.target.id === "infoModalOverlay") {
      UIState.modals.info = false;
      closeInfoPanel();
    }
    if (e.target.id === "movePickerModalOverlay") {
      UIState.modals.movePicker = false;
      closeModal("movePickerModalOverlay");
    }
    if (e.target.id === "moveConfirmModalOverlay") {
      UIState.modals.moveConfirm = false;
      closeModal("moveConfirmModalOverlay");
    }
    if (e.target.id === "moveProgressModalOverlay") {
      UIState.modals.moveProgress = false;
      closeModal("moveProgressModalOverlay");
    }
  }
}

function escToCloseHandler(e) {
  if (e.key === "Escape") {
    if (UIState.modals.upload) {
      UIState.modals.upload = false;
      closeModal("uploadModalOverlay");
    } else if (UIState.modals.preview) {
      UIState.modals.preview = false;
      cleanupPreview();
      closeModal("previewModalOverlay");
    } else if (UIState.modals.createDir) {
      UIState.modals.createDir = false;
      closeModal("createDirModalOverlay");
    } else if (UIState.modals.confirmDelete) {
      UIState.modals.confirmDelete = false;
      closeModal("confirmDeleteModalOverlay");
    } else if (UIState.modals.folderConfirm) {
      UIState.modals.folderConfirm = false;
      closeModal("folderConfirmModalOverlay");
    } else if (UIState.modals.deleteDir) {
      UIState.modals.deleteDir = false;
      closeModal("deleteDirModalOverlay");
    } else if (UIState.modals.changeBucket) {
      UIState.modals.changeBucket = false;
      closeModal("changeBucketModalOverlay");
    } else if (UIState.modals.movePicker) {
      UIState.modals.movePicker = false;
      closeModal("movePickerModalOverlay");
    } else if (UIState.modals.moveConfirm) {
      UIState.modals.moveConfirm = false;
      closeModal("moveConfirmModalOverlay");
    } else if (UIState.modals.moveProgress) {
      UIState.modals.moveProgress = false;
      closeModal("moveProgressModalOverlay");
    } else if (UIState.modals.info) {
      UIState.modals.info = false;
      closeInfoPanel();
    }
  }
}

let focusTrapHandler = null;
function trapFocus(container) {
  focusTrapHandler = (e) => {
    if (e.key !== "Tab") return;
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.from(focusable).filter(
      (el) => !el.hasAttribute("disabled") && el.offsetParent !== null
    );
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  };
  container.addEventListener("keydown", focusTrapHandler, true);
}
function untrapFocus(container) {
  if (focusTrapHandler) container.removeEventListener("keydown", focusTrapHandler, true);
  focusTrapHandler = null;
}

// Credentials validation
function validateConnectForm(showErrors = false) {
  const accessKeyId = el("accessKeyId").value.trim();
  const secretAccessKey = el("secretAccessKey").value.trim();
  const region = el("region").value.trim();
  const bucket = el("bucket").value.trim();

  let ok = true;

  const show = (id, msg, shouldShow) => {
    const e = el(id);
    e.textContent = shouldShow ? msg : "";
    e.hidden = !shouldShow;
  };

  // Required fields: keep ok logic, only show message when showErrors=true
  if (!accessKeyId) {
    ok = false;
    show("accessKeyIdError", "Access Key ID is required.", showErrors);
  } else {
    show("accessKeyIdError", "", false);
  }

  if (!secretAccessKey) {
    ok = false;
    show("secretAccessKeyError", "Secret Access Key is required.", showErrors);
  } else {
    show("secretAccessKeyError", "", false);
  }

  // Region format: show if invalid AND (user typed something) OR (on submit)
  const regionValid = /^[a-z]{2}-[a-z]+-\d$/.test(region);
  if (!regionValid) {
    ok = false;
    const should = showErrors || !!region;
    show("regionError", "Region format looks invalid (e.g., eu-central-1).", should);
  } else {
    show("regionError", "", false);
  }

  // Bucket format: show if invalid AND (user typed something) OR (on submit)
  const bucketValid = isValidBucketName(bucket);
  if (!bucketValid) {
    ok = false;
    const should = showErrors || !!bucket;
    show("bucketError", "Bucket format looks invalid.", should);
  } else {
    show("bucketError", "", false);
  }

  el("connectBtn").disabled = !ok;

  return { accessKeyId, secretAccessKey, region, bucket, ok };
}

function isValidBucketName(bucket) {
  return /^[a-z0-9.-]{3,63}$/.test(bucket);
}

function renderBreadcrumbs() {
  const wrapper = el("crumbs");
  wrapper.innerHTML = "";
  const prefix = NavigationState.currentPrefix;
  const parts = prefix ? prefix.split("/").filter(Boolean) : [];
  let acc = "";
  parts.forEach((p, idx) => {
    acc += p + "/";
    const a = document.createElement("a");
    a.href = "#";
    a.dataset.prefix = acc;
    a.textContent = p;
    // Capture the value for this specific crumb to avoid the closure capturing the final 'acc'
    const targetPrefix = acc;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      navigateToPrefix(targetPrefix);
    });
    // Indicate the current location for accessibility
    if (idx === parts.length - 1) {
      a.setAttribute("aria-current", "page");
    }
    wrapper.appendChild(a);
    if (idx < parts.length - 1) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "/";
      sep.setAttribute("aria-hidden", "true");
      wrapper.appendChild(sep);
    }
  });
}

function navigateToPrefix(prefix) {
  NavigationState.currentPrefix = prefix || "";
  SelectionState.selectedKeys.clear();
  SelectionState.selectedPrefixes.clear();
  SelectionState.selectAllPage = false;
  el("selectAllPage").checked = false;
  filterClear();
  listPrefix(NavigationState.currentPrefix, null, true);
}

// Listing
async function listPrefix(prefix, continuationToken = null, reset = false) {
  if (!s3) return;
  try {
    ListingState.isLoading = true;
    OperationRegistry.listings.status = "running";

    const params = {
      Bucket: SessionState.bucket,
      Prefix: prefix || "",
      Delimiter: "/",
      MaxKeys: Config.listPageSize
    };
    if (continuationToken) params.ContinuationToken = continuationToken;

    clearInlineBanner("listErrorBanner");
    const data = await s3.listObjectsV2(params).promise();

    const newPrefixes = (data.CommonPrefixes || []).map((cp) => ({ prefix: cp.Prefix }));
    const newObjects = (data.Contents || [])
      .filter((o) => o.Key !== (prefix || ""))
      .map((o) => ({
        key: o.Key,
        size: o.Size,
        lastModified: o.LastModified ? new Date(o.LastModified).toLocaleString() : ""
      }));

    if (reset) {
      ListingState.prefixes = [];
      ListingState.objects = [];
      el("rows").innerHTML = "";
      // Insert parent ".." row when inside a directory
      if (NavigationState.currentPrefix) {
        el("rows").appendChild(renderParentRow());
      }
    }

    // Append with incremental rendering
    let idx = 0;
    const chunkSize = 100;
    const totalItems = newPrefixes.length + newObjects.length;
    const rowsContainer = el("rows");

    function renderChunk() {
      const end = Math.min(idx + chunkSize, totalItems);
      for (let i = idx; i < end; i++) {
        if (i < newPrefixes.length) {
          const p = newPrefixes[i];
          ListingState.prefixes.push(p);
          rowsContainer.appendChild(renderPrefixRow(p));
        } else {
          const o = newObjects[i - newPrefixes.length];
          ListingState.objects.push(o);
          rowsContainer.appendChild(renderObjectRow(o));
        }
      }
      idx = end;
      if (idx < totalItems) {
        requestAnimationFrame(renderChunk);
      } else {
        finalizeListing();
      }
    }

    function finalizeListing() {
      ListingState.nextContinuationToken = data.IsTruncated ? data.NextContinuationToken : null;
      el("loadMoreBtn").hidden = !ListingState.nextContinuationToken;
      el("emptyState").hidden = ListingState.prefixes.length + ListingState.objects.length !== 0;
      OperationRegistry.listings.status = "idle";
      ListingState.isLoading = false;
      ListingState.lastRefreshedAt = Date.now();
      renderBreadcrumbs();
    }

    renderChunk();
  } catch (err) {
    ListingState.isLoading = false;
    OperationRegistry.listings.status = "idle";
    categorizeAndSurfaceError(err, "listErrorBanner");
  }
}

function renderParentRow() {
  const row = document.createElement("div");
  row.className = "list-row";
  row.setAttribute("role", "row");
  row.dataset.parentRow = "true";
  row.dataset.entryType = "parent";

  const c0 = document.createElement("div");
  c0.setAttribute("role", "cell");
  // intentionally no checkbox for parent row

  const c1 = document.createElement("div");
  c1.setAttribute("role", "cell");
  c1.className = "name-cell";
  const icon = createFolderIcon();
  const link = document.createElement("a");
  link.href = "#";
  link.textContent = "..";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const cur = NavigationState.currentPrefix || "";
    if (!cur) return;
    const withoutTrailing = cur.endsWith("/") ? cur.slice(0, -1) : cur;
    const idx = withoutTrailing.lastIndexOf("/");
    const parent = idx >= 0 ? withoutTrailing.slice(0, idx + 1) : "";
    navigateToPrefix(parent);
  });
  c1.appendChild(icon);
  c1.appendChild(link);

  const c2 = document.createElement("div");
  c2.setAttribute("role", "cell");
  c2.style.textAlign = "left";
  c2.textContent = "";
  const c3 = document.createElement("div");
  c3.setAttribute("role", "cell");
  c3.textContent = "";

  row.appendChild(c0);
  row.appendChild(c1);
  row.appendChild(c2);
  row.appendChild(c3);
  return row;
}

function renderPrefixRow(p) {
  const row = document.createElement("div");
  row.className = "list-row";
  row.setAttribute("role", "row");
  row.dataset.entryType = "folder";
  row.dataset.fullPath = p.prefix;
  const c0 = document.createElement("div");
  c0.setAttribute("role", "cell");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) SelectionState.selectedPrefixes.add(p.prefix);
    else SelectionState.selectedPrefixes.delete(p.prefix);
    updateSelectionUI();
  });
  c0.appendChild(checkbox);

  const c1 = document.createElement("div");
  c1.setAttribute("role", "cell");
  c1.className = "name-cell";
  const icon = createFolderIcon();
  const link = document.createElement("a");
  link.href = "#";
  link.textContent = formatPrefixLabel(p.prefix, NavigationState.currentPrefix);
  link.addEventListener("click", (e) => {
    e.preventDefault();
    navigateToPrefix(p.prefix);
  });
  c1.appendChild(icon);
  c1.appendChild(link);

  const c2 = document.createElement("div");
  c2.setAttribute("role", "cell");
  c2.style.textAlign = "left";
  c2.textContent = "";
  const c3 = document.createElement("div");
  c3.setAttribute("role", "cell");
  c3.textContent = "";

  row.appendChild(c0);
  row.appendChild(c1);
  row.appendChild(c2);
  row.appendChild(c3);
  return row;
}

function renderObjectRow(o) {
  const row = document.createElement("div");
  row.className = "list-row";
  row.setAttribute("role", "row");
  row.dataset.entryType = "object";
  row.dataset.fullPath = o.key;
  const c0 = document.createElement("div");
  c0.setAttribute("role", "cell");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) SelectionState.selectedKeys.add(o.key);
    else SelectionState.selectedKeys.delete(o.key);
    updateSelectionUI();
  });
  c0.appendChild(checkbox);

  const c1 = document.createElement("div");
  c1.setAttribute("role", "cell");
  c1.className = "name-cell";
  const link = document.createElement("a");
  link.href = "#";
  link.textContent = o.key.substring(NavigationState.currentPrefix.length) || o.key;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    openPreviewModal(o.key);
  });
  c1.appendChild(link);

  const c2 = document.createElement("div");
  c2.setAttribute("role", "cell");
  c2.style.textAlign = "left";
  c2.textContent = formatBytes(o.size);
  const c3 = document.createElement("div");
  c3.setAttribute("role", "cell");
  c3.textContent = o.lastModified || "";

  row.appendChild(c0);
  row.appendChild(c1);
  row.appendChild(c2);
  row.appendChild(c3);
  return row;
}

// Derive full key or prefix from a rendered row
function computeRowFullPath(row) {
  try {
    if (row?.dataset?.parentRow === "true") return null;
    if (row?.dataset?.fullPath) return row.dataset.fullPath;
    const nameCell = row.children[1];
    const link = nameCell?.querySelector("a");
    if (!link) return null;
    const rel = link.textContent || "";
    return (NavigationState.currentPrefix || "") + rel;
  } catch {
    return null;
  }
}

function updateSelectionUI() {
  const selectedCount = SelectionState.selectedKeys.size + SelectionState.selectedPrefixes.size;

  // Enable/disable action buttons based on selection
  el("deleteBtn").disabled = selectedCount === 0;
  const moveBtnEl = el("moveBtn");
  if (moveBtnEl) {
    moveBtnEl.disabled = !(
      SelectionState.selectedKeys.size > 0 && SelectionState.selectedPrefixes.size === 0
    );
  }
  const downloadBtnEl = el("downloadBtn");
  if (downloadBtnEl) {
    downloadBtnEl.disabled = selectedCount === 0;
  }
  el("selectionCount").textContent = selectedCount ? `${selectedCount}` : "";

  // Reconcile per-row checkbox states from SelectionState (source of truth)
  const rowsAll = el("rows").children;
  for (const row of rowsAll) {
    const cb = row.querySelector("input[type='checkbox']");
    if (!cb) continue;
    const isFolder = row.dataset.entryType === "folder";
    const fullPath = computeRowFullPath(row);
    const shouldBeChecked =
      !!fullPath &&
      (isFolder
        ? SelectionState.selectedPrefixes.has(fullPath)
        : SelectionState.selectedKeys.has(fullPath));
    if (cb.checked !== shouldBeChecked) {
      cb.checked = shouldBeChecked;
    }
  }

  // Keep header checkbox state (checked/indeterminate) in sync with VISIBLE row selections
  const header = el("selectAllPage");
  if (header) {
    const rows = el("rows").children;
    let total = 0,
      checked = 0;
    for (const row of rows) {
      if (row.style.display === "none") continue; // only visible rows count toward header state
      const cb = row.querySelector("input[type='checkbox']");
      if (!cb) continue;
      total++;
      if (cb.checked) checked++;
    }
    header.indeterminate = checked > 0 && checked < total;
    header.checked = total > 0 && checked === total;
    SelectionState.selectAllPage = header.checked;
  }
}

// Filtering
function applyFilterLocal() {
  const text = FilterState.text.toLowerCase();
  const rows = el("rows").children;
  for (const row of rows) {
    // Always keep parent ".." row visible
    if (row.dataset && row.dataset.parentRow === "true") {
      row.style.display = "";
      continue;
    }
    const nameCell = row.children[1];
    const nameText = (nameCell?.innerText || "").toLowerCase();
    const matches = nameText.includes(text);
    row.style.display = matches ? "" : "none";
  }
}
function filterClear() {
  FilterState.text = "";
  FilterState.active = false;
  el("filterInput").value = "";
  el("clearFilterBtn").disabled = true;
  const rows = el("rows").children;
  for (const row of rows) row.style.display = "";
}

// Connect and validation
async function connect() {
  const { accessKeyId, secretAccessKey, region, bucket, ok } = validateConnectForm(true);
  if (!ok) return;

  clearInlineBanner("connectGeneralError");

  try {
    AWS.config.update({
      accessKeyId,
      secretAccessKey,
      region
    }); // [AWS.config.update()]
    AWS.config.correctClockSkew = true;

    s3 = new AWS.S3({ signatureVersion: "v4" }); // [AWS.S3()]

    // Minimal list to validate
    const params = { Bucket: bucket, Delimiter: "/", MaxKeys: 1 };
    await s3.listObjectsV2(params).promise();

    // Connected
    SessionState.accessKeyId = accessKeyId;
    SessionState.secretAccessKey = secretAccessKey;
    SessionState.region = region;
    SessionState.bucket = bucket;
    SessionState.connected = true;

    el("connect-card").hidden = true;
    el("app").hidden = false;
    const infoFabEl = el("infoFab");
    if (infoFabEl) infoFabEl.hidden = true;

    el("connBucket").textContent = bucket;
    el("connRegion").textContent = region;
    setAccountMenuVisible(true);

    navigateToPrefix("");
    showToast(
      "Connected",
      `Connected to bucket ${escapeHTML(bucket)} in region ${escapeHTML(region)}.`
    );
  } catch (err) {
    categorizeAndSurfaceError(err, "connectGeneralError");
  }
}

function categorizeAndSurfaceError(err, bannerId) {
  const status = err && (err.statusCode || err.status);
  const code = err && err.code;
  let category = "Unknown error";
  if (status === 403 && code === "SignatureDoesNotMatch")
    category = "Authentication failed (signature mismatch).";
  else if (status === 403 && code === "AccessDenied")
    category = "Insufficient permissions (AccessDenied).";
  else if (status === 404 && code === "NoSuchBucket") category = "NoSuchBucket (bucket not found).";
  else if (
    status === 301 ||
    code === "AuthorizationHeaderMalformed" ||
    code === "PermanentRedirect"
  )
    category = "Region mismatch (bucket is in a different region).";
  else if (code === "NetworkingError" || code === "TimeoutError")
    category = "Network interruption or timeout.";
  const msg = `${category}${err && err.message ? " — " + err.message : ""}`;
  setInlineBanner(bannerId, msg, "error");
  showToast("Error", msg, { autoDismissMs: 12000 });
}

// Upload flows
function openUploadModal() {
  UIState.modals.upload = true;
  renderUploadList();
  openModal("uploadModalOverlay", "uploadModal");
}
function closeUploadModal() {
  UIState.modals.upload = false;
  closeModal("uploadModalOverlay");
  const folderPicker = el("folderPicker");
  if (folderPicker) folderPicker.value = "";
}

function renderUploadList() {
  const cont = el("uploadList");
  cont.innerHTML = "";
  for (const [id, op] of OperationRegistry.uploads.entries()) {
    const item = document.createElement("div");
    item.className = "card upload-item";
    if (op.fadeOut) item.classList.add("upload-item--fade");
    item.innerHTML = `
      <div class="upload-item__row">
        <div class="upload-item__meta">
          <strong>${escapeHTML(op.fileName)}</strong>
          <div class="helper">Key: ${escapeHTML(op.key)}</div>
        </div>
        <div class="upload-item__actions">
          <button class="btn btn-ghost" data-id="${id}" data-action="abort">Cancel</button>
        </div>
      </div>
      <div class="progress" aria-label="Upload progress"><div style="width:${Math.floor(100 * (op.uploadedBytes / Math.max(op.totalBytes, 1)))}%"></div></div>
      <div class="helper">Status: ${escapeHTML(op.status)}</div>
    `;
    cont.appendChild(item);
  }

  cont.querySelectorAll("button[data-action='abort']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const op = OperationRegistry.uploads.get(id);
      if (op && op.managedUpload) {
        try {
          op.managedUpload.abort();
          op.status = "aborted";
          showToast("Upload Aborted", `${escapeHTML(op.fileName)}`);
        } catch {}
      }
      renderUploadList();
    });
  });
}

function addUpload(file, keyOverride, options = {}) {
  const key = keyOverride || NavigationState.currentPrefix + file.name;
  const displayName = keyOverride
    ? keyOverride.replace(NavigationState.currentPrefix, "")
    : file.name;
  const exists = ListingState.objects.some((o) => o.key === key);
  // eslint-disable-next-line no-alert
  const proceed = exists ? confirm(`Overwrite existing object?\n${key}`) : true;
  if (!proceed) return;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const entry = {
    fileName: displayName,
    key,
    totalBytes: file.size,
    uploadedBytes: 0,
    status: "queued",
    notifyOnComplete: options.notifyOnComplete !== false,
    fadeOut: false,
    dismissTimer: null,
    fadeTimer: null,
    parts: [],
    abortController: null,
    uploadId: null,
    managedUpload: null
  };
  OperationRegistry.uploads.set(id, entry);
  renderUploadList();

  if (file.size < Config.multipartThresholdBytes) {
    // Simple managed upload with queueSize=1
    const params = { Bucket: SessionState.bucket, Key: key, Body: file };
    const mu = s3.upload(params, { queueSize: 1 });
    entry.managedUpload = mu;
    entry.status = "running";
    mu.on("httpUploadProgress", (evt) => {
      entry.uploadedBytes = evt.loaded || entry.uploadedBytes;
      renderUploadList();
    });
    mu.promise()
      .then(() => {
        entry.status = "completed";
        if (entry.notifyOnComplete) {
          showToast("Upload Complete", `${escapeHTML(entry.fileName)} uploaded.`);
        }
        refreshListingNonBlocking();
        entry.fadeTimer = setTimeout(() => {
          entry.fadeOut = true;
          renderUploadList();
        }, 8000);
        entry.dismissTimer = setTimeout(() => {
          OperationRegistry.uploads.delete(id);
          renderUploadList();
        }, 10000);
        renderUploadList();
      })
      .catch((err) => {
        entry.status = "failed";
        showToast(
          "Upload Failed",
          `${escapeHTML(file.name)} — ${escapeHTML(err.message || String(err))}`
        );
        renderUploadList();
      });
  } else {
    // Multipart via managed upload with configured partSize and queueSize
    const params = { Bucket: SessionState.bucket, Key: key, Body: file };
    const mu = s3.upload(params, {
      partSize: Config.multipartPartSizeBytes,
      queueSize: Config.multipartConcurrency
    });
    entry.managedUpload = mu;
    entry.status = "running";
    mu.on("httpUploadProgress", (evt) => {
      entry.uploadedBytes = evt.loaded || entry.uploadedBytes;
      renderUploadList();
    });
    mu.promise()
      .then(() => {
        entry.status = "completed";
        if (entry.notifyOnComplete) {
          showToast("Upload Complete", `${escapeHTML(entry.fileName)} uploaded.`);
        }
        refreshListingNonBlocking();
        entry.fadeTimer = setTimeout(() => {
          entry.fadeOut = true;
          renderUploadList();
        }, 8000);
        entry.dismissTimer = setTimeout(() => {
          OperationRegistry.uploads.delete(id);
          renderUploadList();
        }, 10000);
        renderUploadList();
      })
      .catch((err) => {
        entry.status = "failed";
        showToast(
          "Upload Failed",
          `${escapeHTML(file.name)} — ${escapeHTML(err.message || String(err))}`
        );
        renderUploadList();
      });
  }
}

function refreshListingNonBlocking() {
  listPrefix(NavigationState.currentPrefix, null, true);
}

function confirmLargeUpload(count) {
  if (count <= 100) return Promise.resolve(true);
  return new Promise((resolve) => {
    const proceedBtn = el("folderConfirmProceedBtn");
    const cancelBtn = el("folderConfirmCancelBtn");
    const closeBtn = el("closeFolderConfirmModalBtn");
    openFolderConfirmModal(count);
    const cleanup = (result) => {
      if (proceedBtn) proceedBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
      if (closeBtn) closeBtn.onclick = null;
      resolve(result);
    };
    if (proceedBtn)
      proceedBtn.onclick = () => {
        closeFolderConfirmModal();
        cleanup(true);
      };
    if (cancelBtn)
      cancelBtn.onclick = () => {
        closeFolderConfirmModal();
        cleanup(false);
      };
    if (closeBtn)
      closeBtn.onclick = () => {
        closeFolderConfirmModal();
        cleanup(false);
      };
  });
}

async function enqueueFolderFiles(files) {
  if (!files || files.length === 0) return;
  if (!(await confirmLargeUpload(files.length))) return;
  files.forEach((file) => {
    const rel = file.webkitRelativePath || file.name;
    const key = NavigationState.currentPrefix + rel;
    addUpload(file, key, { notifyOnComplete: false });
  });
  showToast("Upload Queued", `${files.length} files queued.`);
}

function traverseEntry(entry, basePath = "") {
  return new Promise((resolve) => {
    if (!entry) return resolve([]);
    if (entry.isFile) {
      entry.file((file) => {
        const relPath = basePath + file.name;
        const wrapped = new File([file], file.name, { type: file.type });
        wrapped.webkitRelativePath = relPath;
        resolve([wrapped]);
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readEntries = () =>
        new Promise((res) => {
          reader.readEntries((entries) => res(entries || []));
        });
      (async () => {
        const files = [];
        let entries = await readEntries();
        while (entries.length) {
          // eslint-disable-next-line no-await-in-loop
          const nested = await Promise.all(
            entries.map((ent) => traverseEntry(ent, basePath + entry.name + "/"))
          );
          nested.forEach((arr) => files.push(...arr));
          // eslint-disable-next-line no-await-in-loop
          entries = await readEntries();
        }
        resolve(files);
      })();
    } else {
      resolve([]);
    }
  });
}

// Preview and Download
async function openPreviewModal(key) {
  UIState.preview = {
    key,
    type: "unknown",
    truncated: false,
    content: null,
    blobUrl: null,
    contentType: ""
  };
  UIState.modals.preview = true;
  el("previewContent").innerHTML = "Loading preview…";
  openModal("previewModalOverlay", "previewModal");

  try {
    // Determine basic type by extension (fallback to getObject ContentType)
    const ext = (key.split(".").pop() || "").toLowerCase();
    const isImageExt = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext);

    if (isImageExt) {
      const data = await s3.getObject({ Bucket: SessionState.bucket, Key: key }).promise();
      const isSvg = ext === "svg";
      const forcedType = isSvg ? "image/svg+xml" : data.ContentType || "application/octet-stream";
      const blob = toBlob(data.Body, forcedType);
      const url = URL.createObjectURL(blob);
      UIState.preview.type = "image";
      UIState.preview.blobUrl = url;
      UIState.preview.contentType = forcedType;
      if (isSvg) {
        el("previewContent").innerHTML =
          `<object type="image/svg+xml" data="${url}" style="max-width:100%;height:auto;border:1px solid var(--border);border-radius:8px;"><div class="inline-banner error">SVG preview failed to render. You can still download.</div></object>`;
      } else {
        el("previewContent").innerHTML =
          `<img src="${url}" alt="Image preview" style="max-width:100%;height:auto;border:1px solid var(--border);border-radius:8px;" />`;
      }
    } else {
      // Text preview: fetch full object (no Range) and truncate client-side to avoid signature issues
      const data = await s3.getObject({ Bucket: SessionState.bucket, Key: key }).promise(); // [S3.getObject()]
      UIState.preview.type = "text";
      UIState.preview.contentType = data.ContentType || "";
      const blob = toBlob(data.Body, "text/plain");
      const fullSize = blob.size || 0;
      const truncatedBlob =
        fullSize > Config.previewTextMaxBytes ? blob.slice(0, Config.previewTextMaxBytes) : blob;
      const text = await truncatedBlob.text();
      UIState.preview.content = text;
      const truncated = fullSize > Config.previewTextMaxBytes;
      UIState.preview.truncated = truncated;
      el("previewContent").innerHTML =
        `<pre style="white-space:pre-wrap;word-wrap:break-word;border:1px solid var(--border);border-radius:8px;padding:12px;max-height:60vh;overflow:auto;">${escapeHTML(text)}${truncated ? "\n\n[Preview truncated]" : ""}</pre>`;
    }
    // Hook up download
    el("previewDownloadBtn").onclick = () => downloadKey(key);
  } catch (err) {
    el("previewContent").innerHTML =
      `<div class="inline-banner error">Preview failed — ${escapeHTML(err.message || String(err))}. You can still download.</div>`;
    el("previewDownloadBtn").onclick = () => downloadKey(key);
  }
}

function cleanupPreview() {
  if (UIState.preview.blobUrl) {
    try {
      URL.revokeObjectURL(UIState.preview.blobUrl);
    } catch {}
  }
  UIState.preview = {
    key: "",
    type: "unknown",
    truncated: false,
    content: null,
    blobUrl: null,
    contentType: ""
  };
}

async function downloadKey(key) {
  try {
    const data = await s3.getObject({ Bucket: SessionState.bucket, Key: key }).promise();
    const blob = toBlob(data.Body, data.ContentType || "application/octet-stream");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = key.split("/").pop() || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast("Download", `Started download for ${escapeHTML(key)}.`);

    // Auto-deselect after successful single-object download
    SelectionState.selectedKeys.clear();
    SelectionState.selectedPrefixes.clear();
    SelectionState.selectAllPage = false;
    const selectAll = el("selectAllPage");
    if (selectAll) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    }
    updateSelectionUI();
  } catch (err) {
    showToast("Download Failed", `${escapeHTML(err.message || String(err))}`, {
      autoDismissMs: 12000
    });
  }
}

function toBlob(body, contentType) {
  if (!body) return new Blob([], { type: contentType });
  // AWS SDK v2 browser may deliver ArrayBuffer, Blob, TypedArray
  try {
    if (body instanceof Blob) return body;
  } catch {}
  try {
    if (body.buffer) return new Blob([body.buffer], { type: contentType });
  } catch {}
  try {
    if (body instanceof ArrayBuffer) return new Blob([body], { type: contentType });
  } catch {}
  try {
    return new Blob([body], { type: contentType });
  } catch {
    return new Blob([], { type: contentType });
  }
}

async function bodyToArrayBuffer(body) {
  const blob = toBlob(body, "application/octet-stream");
  return await blob.arrayBuffer();
}

async function copyTextById(id) {
  const block = el(id);
  const text = block ? block.textContent || "" : "";
  if (!text) throw new Error("Nothing to copy");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand ? document.execCommand("copy") : false;
    ta.remove();
    if (!ok) throw new Error("Clipboard unavailable");
  }
}
// Create directory
async function createDirectory(name) {
  const trimmed = (name || "").trim();
  const valid = Config.allowedDirNamePattern.test(trimmed);
  if (!valid) {
    el("dirNameError").textContent =
      "Invalid name. Allowed: letters, numbers, dot, underscore, hyphen.";
    el("dirNameError").hidden = false;
    return;
  }
  el("dirNameError").hidden = true;

  const key = NavigationState.currentPrefix + trimmed + "/";
  try {
    await s3
      .putObject({
        Bucket: SessionState.bucket,
        Key: key,
        Body: new Uint8Array(0),
        ContentLength: 0
      })
      .promise();
    showToast("Directory Created", `${escapeHTML(key)}`);
    closeCreateDirModal();
    refreshListingNonBlocking();
  } catch (err) {
    el("dirNameError").textContent = err.message || String(err);
    el("dirNameError").hidden = false;
  }
}

function openCreateDirModal() {
  UIState.modals.createDir = true;
  el("dirName").value = "";
  el("dirNameError").hidden = true;
  openModal("createDirModalOverlay", "createDirModal");
}
function closeCreateDirModal() {
  UIState.modals.createDir = false;
  closeModal("createDirModalOverlay");
}

// Delete object or directory
function openConfirmDeleteModal() {
  const keys = Array.from(SelectionState.selectedKeys);
  const prefixes = Array.from(SelectionState.selectedPrefixes);
  if (keys.length === 0 && prefixes.length === 0) return;

  UIState.modals.confirmDelete = true;
  const body = el("confirmDeleteBody");
  if (keys.length && !prefixes.length) {
    body.innerHTML = `<p>Delete the following object(s)? This action is irreversible.</p><ul>${keys.map((k) => `<li>${escapeHTML(k)}</li>`).join("")}</ul>`;
    el("confirmDeleteBtn").onclick = async () => {
      await deleteObjects(keys);
      UIState.modals.confirmDelete = false;
      closeModal("confirmDeleteModalOverlay");
    };
  } else if (!keys.length && prefixes.length) {
    body.innerHTML = `<p>Delete the following directory-like prefix(es)? This removes all objects under each prefix. Irreversible.</p><ul>${prefixes.map((p) => `<li>${escapeHTML(p)}</li>`).join("")}</ul>`;
    el("confirmDeleteBtn").onclick = () => {
      UIState.modals.confirmDelete = false;
      closeModal("confirmDeleteModalOverlay");
      // Open bulk delete modal for first selected prefix (one at a time)
      if (prefixes.length) openDeleteDirModal(prefixes[0]);
    };
  } else {
    body.innerHTML = `<p>Mixed selection detected. Please delete objects and directories separately.</p>`;
    el("confirmDeleteBtn").onclick = () => {
      UIState.modals.confirmDelete = false;
      closeModal("confirmDeleteModalOverlay");
    };
  }

  openModal("confirmDeleteModalOverlay", "confirmDeleteModal");
}

async function deleteObjects(keys) {
  try {
    for (const key of keys) {
      await s3.deleteObject({ Bucket: SessionState.bucket, Key: key }).promise();
    }
    showToast("Delete", `Deleted ${keys.length} object(s).`);
    // Reset selection state after any delete operation
    SelectionState.selectedKeys.clear();
    SelectionState.selectedPrefixes.clear();
    SelectionState.selectAllPage = false;
    const selectAll = el("selectAllPage");
    if (selectAll) selectAll.checked = false;
    updateSelectionUI();
    refreshListingNonBlocking();
  } catch (err) {
    showToast("Delete Failed", `${escapeHTML(err.message || String(err))}`, {
      autoDismissMs: 12000
    });
  }
}

async function openDeleteDirModal(prefix) {
  UIState.modals.deleteDir = true;
  el("deleteDirCount").textContent = "Preparing…";
  el("deleteDirFailures").hidden = true;
  el("deleteDirFailureList").innerHTML = "";
  el("deleteDirRetryBtn").hidden = true;
  el("deleteDirConfirmBtn").disabled = false;

  // Reset the object list section
  const listCont = el("deleteDirKeyList");
  const listItems = el("deleteDirKeyListItems");
  if (listCont && listItems) {
    listCont.hidden = true;
    listItems.innerHTML = "";
  }

  openModal("deleteDirModalOverlay", "deleteDirModal");

  // Count objects under prefix
  try {
    const keys = await enumerateKeysUnderPrefix(prefix);
    el("deleteDirCount").textContent = `Objects to delete under "${prefix}": ${keys.length}`;

    // Render keys list
    if (listCont && listItems) {
      if (keys.length > 0) {
        const frag = document.createDocumentFragment();
        keys.forEach((k) => {
          const li = document.createElement("li");
          li.textContent = k;
          frag.appendChild(li);
        });
        listItems.innerHTML = "";
        listItems.appendChild(frag);
        listCont.hidden = false;
      } else {
        listCont.hidden = true;
        listItems.innerHTML = "";
      }
    }

    el("deleteDirConfirmBtn").onclick = async () => {
      await bulkDeleteKeys(keys);
    };
    el("deleteDirRetryBtn").onclick = async () => {
      const failed = Array.from(el("deleteDirFailureList").querySelectorAll("li")).map(
        (li) => li.dataset.key
      );
      await bulkDeleteKeys(failed);
    };
  } catch (err) {
    el("deleteDirCount").textContent = `Failed to enumerate keys — ${err.message || String(err)}`;
    el("deleteDirConfirmBtn").disabled = true;
  }
}

async function enumerateKeysUnderPrefix(prefix) {
  const keys = [];
  let token = null;
  do {
    const params = {
      Bucket: SessionState.bucket,
      Prefix: prefix,
      MaxKeys: 1000
    };
    if (token) params.ContinuationToken = token;
    const data = await s3.listObjectsV2(params).promise();
    (data.Contents || []).forEach((o) => keys.push(o.Key));
    token = data.IsTruncated ? data.NextContinuationToken : null;
  } while (token);
  return keys;
}

async function bulkDeleteKeys(keys) {
  const total = keys.length;
  let deleted = 0;
  const failures = [];
  const bar = el("deleteDirProgressBar");
  const failureList = el("deleteDirFailureList");

  for (let i = 0; i < keys.length; i += Config.deleteBatchSize) {
    const batch = keys.slice(i, i + Config.deleteBatchSize);
    try {
      const resp = await s3
        .deleteObjects({
          Bucket: SessionState.bucket,
          Delete: { Objects: batch.map((k) => ({ Key: k })) }
        })
        .promise();

      deleted += (resp.Deleted || []).length;
      const errs = resp.Errors || [];
      errs.forEach((e) => failures.push({ key: e.Key, code: e.Code, msg: e.Message || "" }));

      bar.style.width = `${Math.floor(100 * (deleted / total))}%`;
    } catch (err) {
      // Entire batch failed
      batch.forEach((k) =>
        failures.push({ key: k, code: "BatchError", msg: err.message || String(err) })
      );
    }
  }

  if (failures.length) {
    el("deleteDirFailures").hidden = false;
    failureList.innerHTML = failures
      .map(
        (f) =>
          `<li data-key="${escapeHTML(f.key)}">${escapeHTML(f.key)} — ${escapeHTML(f.code)} ${escapeHTML(f.msg)}</li>`
      )
      .join("");
    el("deleteDirRetryBtn").hidden = false;
    showToast(
      "Partial Failures",
      `${failures.length} item(s) failed to delete. Review and retry.`,
      { autoDismissMs: 15000 }
    );
  } else {
    showToast("Delete Complete", `Deleted ${total} item(s).`);
    UIState.modals.deleteDir = false;
    closeModal("deleteDirModalOverlay");
  }

  // Reset selection state after directory delete (regardless of failures)
  SelectionState.selectedKeys.clear();
  SelectionState.selectedPrefixes.clear();
  SelectionState.selectAllPage = false;
  const selectAll = el("selectAllPage");
  if (selectAll) selectAll.checked = false;

  updateSelectionUI();
  refreshListingNonBlocking();
}

// Move helpers and flows
function getBaseName(key) {
  const parts = String(key).split("/");
  return parts[parts.length - 1] || "";
}

async function listPrefixesOnly(prefix) {
  if (!s3) return [];
  const params = {
    Bucket: SessionState.bucket,
    Prefix: prefix || "",
    Delimiter: "/",
    MaxKeys: Config.listPageSize
  };
  const data = await s3.listObjectsV2(params).promise();
  return (data.CommonPrefixes || []).map((cp) => cp.Prefix);
}

function renderMovePickerBreadcrumbs() {
  const wrapper = el("movePickerBreadcrumbs");
  if (!wrapper) return;
  wrapper.innerHTML = "";
  const prefix = MoveState.pickerPrefix || "";
  const parts = prefix ? prefix.split("/").filter(Boolean) : [];
  let acc = "";
  const root = document.createElement("a");
  root.href = "#";
  root.dataset.prefix = "";
  root.textContent = "/";
  root.id = "move-crumb-root";
  root.addEventListener("click", (e) => {
    e.preventDefault();
    MoveState.pickerPrefix = "";
    renderMovePicker();
  });
  wrapper.appendChild(root);
  if (parts.length) {
    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.textContent = "";
    sep.setAttribute("aria-hidden", "true");
    wrapper.appendChild(sep);
  }
  parts.forEach((p, idx) => {
    acc += p + "/";
    const a = document.createElement("a");
    a.href = "#";
    a.dataset.prefix = acc;
    a.textContent = p;
    const targetPrefix = acc;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      MoveState.pickerPrefix = targetPrefix;
      renderMovePicker();
    });
    if (idx === parts.length - 1) a.setAttribute("aria-current", "page");
    wrapper.appendChild(a);
    if (idx < parts.length - 1) {
      const sep2 = document.createElement("span");
      sep2.className = "crumb-sep";
      sep2.textContent = "/";
      sep2.setAttribute("aria-hidden", "true");
      wrapper.appendChild(sep2);
    }
  });
}

async function renderMovePicker() {
  renderMovePickerBreadcrumbs();
  const listCont = el("movePickerPrefixList");
  if (!listCont) return;
  listCont.innerHTML = "";

  const tableHeader = document.createElement("div");
  tableHeader.className = "list-header";
  tableHeader.setAttribute("role", "row");
  tableHeader.innerHTML = `<div role="columnheader"></div><div role="columnheader">Name</div><div role="columnheader" style="text-align:left">-</div><div role="columnheader">-</div>`;
  listCont.appendChild(tableHeader);

  const rowsGroup = document.createElement("div");
  rowsGroup.id = "movePickerRows";
  rowsGroup.setAttribute("role", "rowgroup");
  listCont.appendChild(rowsGroup);

  // Parent ".."
  if (MoveState.pickerPrefix) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.setAttribute("role", "row");
    row.dataset.parentRow = "true";

    const c0 = document.createElement("div");
    c0.setAttribute("role", "cell");
    const c1 = document.createElement("div");
    c1.setAttribute("role", "cell");
    c1.className = "name-cell";
    const icon = createFolderIcon();
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = "..";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const cur = MoveState.pickerPrefix || "";
      const withoutTrailing = cur.endsWith("/") ? cur.slice(0, -1) : cur;
      const idx = withoutTrailing.lastIndexOf("/");
      const parent = idx >= 0 ? withoutTrailing.slice(0, idx + 1) : "";
      MoveState.pickerPrefix = parent;
      renderMovePicker();
    });
    c1.appendChild(icon);
    c1.appendChild(link);
    const c2 = document.createElement("div");
    c2.setAttribute("role", "cell");
    c2.style.textAlign = "left";
    c2.textContent = "";
    const c3 = document.createElement("div");
    c3.setAttribute("role", "cell");
    c3.textContent = "";

    row.appendChild(c0);
    row.appendChild(c1);
    row.appendChild(c2);
    row.appendChild(c3);
    rowsGroup.appendChild(row);
  }

  try {
    const prefixes = await listPrefixesOnly(MoveState.pickerPrefix || "");
    prefixes.forEach((p) => {
      const row = document.createElement("div");
      row.className = "list-row";
      row.setAttribute("role", "row");

      const c0 = document.createElement("div");
      c0.setAttribute("role", "cell");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = true;
      c0.appendChild(checkbox);

      const c1 = document.createElement("div");
      c1.setAttribute("role", "cell");
      c1.className = "name-cell";
      const icon = createFolderIcon();
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = formatPrefixLabel(p, MoveState.pickerPrefix || "");
      link.addEventListener("click", (e) => {
        e.preventDefault();
        MoveState.pickerPrefix = p;
        renderMovePicker();
      });
      c1.appendChild(icon);
      c1.appendChild(link);

      const c2 = document.createElement("div");
      c2.setAttribute("role", "cell");
      c2.style.textAlign = "left";
      c2.textContent = "";
      const c3 = document.createElement("div");
      c3.setAttribute("role", "cell");
      c3.textContent = "";

      row.appendChild(c0);
      row.appendChild(c1);
      row.appendChild(c2);
      row.appendChild(c3);
      rowsGroup.appendChild(row);
    });
    // Destination is the current pickerPrefix
    MoveState.destPrefix = MoveState.pickerPrefix || "";
    const selectBtn = el("movePickerSelectBtn");
    if (selectBtn) selectBtn.disabled = false;
  } catch (err) {
    setInlineBanner("listErrorBanner", err.message || String(err), "error");
    const selectBtn = el("movePickerSelectBtn");
    if (selectBtn) selectBtn.disabled = true;
  }
}

function openMovePickerModal() {
  const hasPrefixSelected = SelectionState.selectedPrefixes.size > 0;
  const hasKeySelected = SelectionState.selectedKeys.size > 0;
  if (!hasKeySelected || hasPrefixSelected) {
    showToast(
      "Move Not Supported",
      "Select one or more objects only. Moving directory prefixes is not supported."
    );
    return;
  }
  UIState.modals.movePicker = true;
  MoveState.pickerPrefix = NavigationState.currentPrefix || "";
  MoveState.destPrefix = MoveState.pickerPrefix;
  MoveState.conflicts = [];
  renderMovePicker();
  openModal("movePickerModalOverlay", "movePickerModal");
}

async function preflightMoveConflicts(keys, destPrefix) {
  const conflicts = [];
  for (const key of keys) {
    const destKey = String(destPrefix || "") + getBaseName(key);
    try {
      await s3.headObject({ Bucket: SessionState.bucket, Key: destKey }).promise();
      conflicts.push(destKey);
    } catch (err) {
      const status = err && (err.statusCode || err.status);
      const code = err && err.code;
      // Treat NotFound as no conflict; other errors ignored for preflight
      if (status === 404 || code === "NotFound" || code === "NoSuchKey") {
        // no conflict
      }
    }
  }
  return conflicts;
}

function openMoveConfirmModal(keys, destPrefix, conflicts) {
  UIState.modals.moveConfirm = true;
  const summary = el("moveConfirmSummary");
  const card = el("moveConflictsCard");
  const list = el("moveConflictList");
  if (summary) {
    const destLabel = destPrefix && destPrefix.length ? destPrefix : "/";
    summary.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="type-badge" title="Selected items">${keys.length} item${keys.length === 1 ? "" : "s"}</span>
        <span class="crumb-sep" aria-hidden="true">›</span>
        <span class="helper">Destination</span>
        <span class="type-badge" title="Destination prefix">${escapeHTML(destLabel)}</span>
      </div>
    `;
  }
  if (conflicts && conflicts.length) {
    if (list) list.innerHTML = conflicts.map((k) => `<li>${escapeHTML(k)}</li>`).join("");
    if (card) card.hidden = false;
  } else {
    if (card) card.hidden = true;
    if (list) list.innerHTML = "";
  }
  openModal("moveConfirmModalOverlay", "moveConfirmModal");
}

async function performBulkMove(keys, destPrefix) {
  UIState.modals.moveConfirm = false;
  closeModal("moveConfirmModalOverlay");

  UIState.modals.moveProgress = true;
  const countEl = el("moveProgressCount");
  const bar = el("moveProgressBar");
  const failuresCard = el("moveFailures");
  const failureList = el("moveFailureList");
  const retryBtn = el("moveRetryFailedBtn");

  if (failuresCard) failuresCard.hidden = true;
  if (failureList) failureList.innerHTML = "";
  if (retryBtn) retryBtn.hidden = true;
  if (bar) bar.style.width = "0%";
  if (countEl) countEl.textContent = `Moving 0 of ${keys.length}…`;

  openModal("moveProgressModalOverlay", "moveProgressModal");

  let moved = 0;
  const failures = [];

  for (const key of keys) {
    const destKey = String(destPrefix || "") + getBaseName(key);
    try {
      // Skip if dest equals src (no-op)
      if (destKey === key) {
        moved++;
        if (bar) bar.style.width = `${Math.floor(100 * (moved / keys.length))}%`;
        if (countEl) countEl.textContent = `Moving ${moved} of ${keys.length}…`;
        continue;
      }
      await s3
        .copyObject({
          Bucket: SessionState.bucket,
          Key: destKey,
          CopySource: encodeURIComponent(`${SessionState.bucket}/${key}`)
        })
        .promise();
      await s3.deleteObject({ Bucket: SessionState.bucket, Key: key }).promise();
      moved++;
      if (bar) bar.style.width = `${Math.floor(100 * (moved / keys.length))}%`;
      if (countEl) countEl.textContent = `Moving ${moved} of ${keys.length}…`;
    } catch (err) {
      failures.push({ key, destKey, code: err?.code || "Error", msg: err?.message || String(err) });
      if (countEl) countEl.textContent = `Moving ${moved} of ${keys.length}…`;
    }
  }

  if (failures.length) {
    if (failuresCard) failuresCard.hidden = false;
    if (failureList) {
      failureList.innerHTML = failures
        .map(
          (f) =>
            `<li data-key="${escapeHTML(f.key)}" data-dest="${escapeHTML(f.destKey)}">${escapeHTML(f.key)} → ${escapeHTML(f.destKey)} — ${escapeHTML(f.code)} ${escapeHTML(f.msg)}</li>`
        )
        .join("");
    }
    if (retryBtn) retryBtn.hidden = false;
    showToast("Partial Failures", `${failures.length} item(s) failed to move. Review and retry.`, {
      autoDismissMs: 15000
    });
  } else {
    showToast("Move Complete", `Moved ${keys.length} item(s).`);
    UIState.modals.moveProgress = false;
    closeModal("moveProgressModalOverlay");
  }

  // Reset selection after move
  SelectionState.selectedKeys.clear();
  SelectionState.selectedPrefixes.clear();
  SelectionState.selectAllPage = false;
  const selectAll = el("selectAllPage");
  if (selectAll) selectAll.checked = false;

  updateSelectionUI();
  refreshListingNonBlocking();
}

// Download flows
function formatArchiveName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `s3-download-${ts}.zip`;
}

function openDownloadProgressModal() {
  UIState.modals.downloadProgress = true;
  const countEl = el("downloadProgressCount");
  const bar = el("downloadProgressBar");
  const failureCard = el("downloadFailures");
  const failureList = el("downloadFailureList");
  if (countEl) countEl.textContent = "Preparing…";
  if (bar) bar.style.width = "0%";
  if (failureCard) failureCard.hidden = true;
  if (failureList) failureList.innerHTML = "";
  const retryBtn = el("downloadRetryFailedBtn");
  if (retryBtn) retryBtn.hidden = true;
  openModal("downloadProgressModalOverlay", "downloadProgressModal");
}

function closeDownloadProgressModal() {
  UIState.modals.downloadProgress = false;
  closeModal("downloadProgressModalOverlay");
}

async function gatherSelectionKeys() {
  const keys = new Set(Array.from(SelectionState.selectedKeys));
  const prefixes = Array.from(SelectionState.selectedPrefixes);
  for (const p of prefixes) {
    try {
      const under = await enumerateKeysUnderPrefix(p);
      under.forEach((k) => keys.add(k));
    } catch (err) {
      showToast("Enumeration Failed", `${escapeHTML(err.message || String(err))}`);
    }
  }
  return Array.from(keys);
}

async function startMultiDownload() {
  if (!s3) return;
  try {
    const hasPrefixes = SelectionState.selectedPrefixes.size > 0;
    const selectedKeys = Array.from(SelectionState.selectedKeys);
    if (selectedKeys.length === 1 && !hasPrefixes) {
      await downloadKey(selectedKeys[0]);
      return;
    }
    const keys = await gatherSelectionKeys();
    if (keys.length === 0) {
      showToast("Download", "Nothing to download.");
      return;
    }
    if (keys.length === 1) {
      await downloadKey(keys[0]);
      return;
    }
    await buildZipAndDownload(keys);
  } catch (err) {
    showToast("Download Failed", `${escapeHTML(err.message || String(err))}`, {
      autoDismissMs: 12000
    });
  }
}

async function buildZipAndDownload(keys) {
  openDownloadProgressModal();
  DownloadState.inProgress = true;
  DownloadState.zip = new JSZip();
  DownloadState.keysTotal = keys.length;
  DownloadState.keysFetched = 0;
  DownloadState.failures = [];
  const bar = el("downloadProgressBar");
  const countEl = el("downloadProgressCount");
  const failureCard = el("downloadFailures");
  const failureList = el("downloadFailureList");
  const concurrency = Config.downloadConcurrency || 4;
  let index = 0;
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= keys.length) return;
      const key = keys[i];
      try {
        const data = await s3.getObject({ Bucket: SessionState.bucket, Key: key }).promise();
        const ab = await bodyToArrayBuffer(data.Body);
        DownloadState.zip.file(key, ab);
      } catch (err) {
        DownloadState.failures.push({
          key,
          code: err?.code || "Error",
          msg: err?.message || String(err)
        });
      } finally {
        DownloadState.keysFetched++;
        if (bar)
          bar.style.width = `${Math.floor(100 * (DownloadState.keysFetched / DownloadState.keysTotal))}%`;
        if (countEl)
          countEl.textContent = `Fetched ${DownloadState.keysFetched} of ${DownloadState.keysTotal}…`;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, () => worker()));
  if (DownloadState.failures.length) {
    if (failureCard) failureCard.hidden = false;
    if (failureList) {
      failureList.innerHTML = DownloadState.failures
        .map(
          (f) =>
            `<li data-key="${escapeHTML(f.key)}">${escapeHTML(f.key)} — ${escapeHTML(f.code)} ${escapeHTML(f.msg)}</li>`
        )
        .join("");
    }
    const retryBtn = el("downloadRetryFailedBtn");
    if (retryBtn) retryBtn.hidden = false;
    return;
  }
  await finalizeZipAndDownload();
}

async function retryFailedDownloads(failedKeys) {
  const bar = el("downloadProgressBar");
  const countEl = el("downloadProgressCount");
  const failureCard = el("downloadFailures");
  const failureList = el("downloadFailureList");
  const retryBtn = el("downloadRetryFailedBtn");
  if (retryBtn) retryBtn.hidden = true;
  if (failureCard) failureCard.hidden = true;
  if (failureList) failureList.innerHTML = "";
  const concurrency = Config.downloadConcurrency || 4;
  DownloadState.failures = [];
  let index = 0;
  const total = failedKeys.length;
  let done = 0;
  function update() {
    if (bar)
      bar.style.width = `${Math.floor(100 * (DownloadState.keysFetched / Math.max(DownloadState.keysTotal, 1)))}%`;
    if (countEl) countEl.textContent = `Retrying ${done} of ${total} failed…`;
  }
  update();
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= failedKeys.length) return;
      const key = failedKeys[i];
      try {
        const data = await s3.getObject({ Bucket: SessionState.bucket, Key: key }).promise();
        const ab = await bodyToArrayBuffer(data.Body);
        DownloadState.zip.file(key, ab);
      } catch (err) {
        DownloadState.failures.push({
          key,
          code: err?.code || "Error",
          msg: err?.message || String(err)
        });
      } finally {
        done++;
        DownloadState.keysFetched++;
        update();
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, failedKeys.length) }, () => worker())
  );
  if (DownloadState.failures.length) {
    if (failureCard) failureCard.hidden = false;
    if (failureList) {
      failureList.innerHTML = DownloadState.failures
        .map(
          (f) =>
            `<li data-key="${escapeHTML(f.key)}">${escapeHTML(f.key)} — ${escapeHTML(f.code)} ${escapeHTML(f.msg)}</li>`
        )
        .join("");
    }
    if (retryBtn) retryBtn.hidden = false;
    return;
  }
  await finalizeZipAndDownload();
}

async function finalizeZipAndDownload() {
  const bar = el("downloadProgressBar");
  const countEl = el("downloadProgressCount");
  if (countEl) countEl.textContent = "Compressing…";
  try {
    const blob = await DownloadState.zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
      (meta) => {
        const pct = Math.floor(meta.percent || 0);
        if (bar) bar.style.width = `${pct}%`;
        if (countEl) countEl.textContent = `Compressing ${pct}%…`;
      }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = formatArchiveName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast("Download", "Archive download started.");

    // Reset selection after download
    SelectionState.selectedKeys.clear();
    SelectionState.selectedPrefixes.clear();
    SelectionState.selectAllPage = false;
    const selectAll = el("selectAllPage");
    if (selectAll) selectAll.checked = false;
    updateSelectionUI();

    closeDownloadProgressModal();
  } catch (err) {
    showToast("Download Failed", `${escapeHTML(err.message || String(err))}`, {
      autoDismissMs: 12000
    });
  } finally {
    DownloadState.inProgress = false;
    DownloadState.zip = null;
    DownloadState.keysTotal = 0;
    DownloadState.keysFetched = 0;
    DownloadState.failures = [];
  }
}

// Sign-out
function signOut() {
  // Abort uploads
  for (const [, op] of OperationRegistry.uploads.entries()) {
    try {
      op.managedUpload?.abort();
    } catch {}
  }
  OperationRegistry.uploads.clear();
  OperationRegistry.deletes.clear();
  OperationRegistry.listings.status = "idle";

  // Purge credentials
  SessionState.accessKeyId = "";
  SessionState.secretAccessKey = "";
  SessionState.region = "";
  SessionState.bucket = "";
  SessionState.connected = false;

  // Reset UI
  s3 = null;
  NavigationState.currentPrefix = "";
  NavigationState.breadcrumbs = [];
  ListingState.objects = [];
  ListingState.prefixes = [];
  ListingState.nextContinuationToken = null;
  ListingState.isLoading = false;
  ListingState.lastRefreshedAt = null;

  SelectionState.selectedKeys.clear();
  SelectionState.selectedPrefixes.clear();
  SelectionState.selectAllPage = false;

  FilterState.text = "";
  FilterState.active = false;

  el("rows").innerHTML = "";
  el("loadMoreBtn").hidden = true;
  el("emptyState").hidden = true;
  el("connect-card").hidden = false;
  el("app").hidden = true;
  const infoFabEl = el("infoFab");
  if (infoFabEl) infoFabEl.hidden = false;
  setAccountMenuVisible(false);
  el("accessKeyId").value = "";
  el("secretAccessKey").value = "";
  el("region").value = "";
  el("bucket").value = "";
  validateConnectForm(false);

  showToast("Signed Out", "Session reset. Credentials purged.");
}

// Event bindings
function bindEvents() {
  ["accessKeyId", "secretAccessKey", "region", "bucket"].forEach((id) => {
    el(id).addEventListener("input", () => validateConnectForm(false));
  });

  el("connectBtn").addEventListener("click", connect);

  el("crumb-root").addEventListener("click", (e) => {
    e.preventDefault();
    navigateToPrefix("");
  });

  const signOutBtn = el("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", signOut);

  const mobileMenuBtn = el("mobileMenuBtn");
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", () => {
      openMobileMenu();
    });
  }
  const mobileMenuOverlay = el("mobileMenuOverlay");
  if (mobileMenuOverlay) {
    mobileMenuOverlay.addEventListener("click", (e) => {
      if (e.target === mobileMenuOverlay) closeMobileMenu();
    });
  }
  const closeMobileMenuBtn = el("closeMobileMenuBtn");
  if (closeMobileMenuBtn) {
    closeMobileMenuBtn.addEventListener("click", () => closeMobileMenu());
  }
  const mobileChangeBucketBtn = el("mobileChangeBucketBtn");
  if (mobileChangeBucketBtn) {
    mobileChangeBucketBtn.addEventListener("click", () => {
      closeMobileMenu();
      openChangeBucketModal();
    });
  }
  const mobileSignOutBtn = el("mobileSignOutBtn");
  if (mobileSignOutBtn) {
    mobileSignOutBtn.addEventListener("click", () => {
      closeMobileMenu();
      signOut();
    });
  }

  const closeChangeBucketModalBtn = el("closeChangeBucketModalBtn");
  if (closeChangeBucketModalBtn) {
    closeChangeBucketModalBtn.addEventListener("click", () => {
      UIState.modals.changeBucket = false;
      closeModal("changeBucketModalOverlay");
    });
  }
  const changeBucketCancelBtn = el("changeBucketCancelBtn");
  if (changeBucketCancelBtn) {
    changeBucketCancelBtn.addEventListener("click", () => {
      UIState.modals.changeBucket = false;
      closeModal("changeBucketModalOverlay");
    });
  }
  const changeBucketSaveBtn = el("changeBucketSaveBtn");
  if (changeBucketSaveBtn) {
    changeBucketSaveBtn.addEventListener("click", () => changeBucketFlow());
  }
  const changeBucketInput = el("changeBucketInput");
  if (changeBucketInput) {
    changeBucketInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        changeBucketFlow();
      }
    });
  }

  const folderConfirmCancelBtn = el("folderConfirmCancelBtn");
  if (folderConfirmCancelBtn) {
    folderConfirmCancelBtn.addEventListener("click", () => closeFolderConfirmModal());
  }
  const folderConfirmCloseBtn = el("closeFolderConfirmModalBtn");
  if (folderConfirmCloseBtn) {
    folderConfirmCloseBtn.addEventListener("click", () => closeFolderConfirmModal());
  }
  const folderConfirmProceedBtn = el("folderConfirmProceedBtn");
  if (folderConfirmProceedBtn) {
    folderConfirmProceedBtn.addEventListener("click", () => closeFolderConfirmModal());
  }

  el("uploadBtn").addEventListener("click", openUploadModal);
  el("openFilePickerBtn").addEventListener("click", () => el("filePicker").click());
  el("openFolderPickerBtn").addEventListener("click", () => el("folderPicker").click());
  el("filePicker").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    const notifyOnComplete = files.length <= 1;
    files.forEach((file) => addUpload(file, null, { notifyOnComplete }));
    if (files.length > 1) {
      showToast("Upload Queued", `${files.length} files queued.`);
    }
  });
  el("folderPicker").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    enqueueFolderFiles(files);
  });

  const dropzone = el("dropzone");
  dropzone.addEventListener("click", () => el("filePicker").click());
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const items = Array.from(e.dataTransfer.items || []);
    const entries = items
      .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (entries.length > 0) {
      Promise.all(entries.map((entry) => traverseEntry(entry))).then(async (nested) => {
        const files = nested.flat();
        if (files.length) await enqueueFolderFiles(files);
        else {
          const fallback = Array.from(e.dataTransfer.files || []);
          fallback.forEach(addUpload);
        }
      });
      return;
    }
    const files = Array.from(e.dataTransfer.files || []);
    const notifyOnComplete = files.length <= 1;
    files.forEach((file) => addUpload(file, null, { notifyOnComplete }));
    if (files.length > 1) {
      showToast("Upload Queued", `${files.length} files queued.`);
    }
  });

  el("closeUploadModalBtn").addEventListener("click", closeUploadModal);
  el("uploadCloseBtn").addEventListener("click", closeUploadModal);

  el("previewCloseBtn").addEventListener("click", () => {
    UIState.modals.preview = false;
    cleanupPreview();
    closeModal("previewModalOverlay");
  });
  el("closePreviewModalBtn").addEventListener("click", () => {
    UIState.modals.preview = false;
    cleanupPreview();
    closeModal("previewModalOverlay");
  });

  el("createDirBtn").addEventListener("click", openCreateDirModal);
  el("createDirConfirmBtn").addEventListener("click", () => createDirectory(el("dirName").value));
  el("createDirCancelBtn").addEventListener("click", closeCreateDirModal);
  el("closeCreateDirModalBtn").addEventListener("click", closeCreateDirModal);

  el("deleteBtn").addEventListener("click", openConfirmDeleteModal);
  el("confirmDeleteCancelBtn").addEventListener("click", () => {
    UIState.modals.confirmDelete = false;
    closeModal("confirmDeleteModalOverlay");
  });
  el("closeConfirmDeleteModalBtn").addEventListener("click", () => {
    UIState.modals.confirmDelete = false;
    closeModal("confirmDeleteModalOverlay");
  });

  el("deleteDirCancelBtn").addEventListener("click", () => {
    UIState.modals.deleteDir = false;
    closeModal("deleteDirModalOverlay");
  });
  el("closeDeleteDirModalBtn").addEventListener("click", () => {
    UIState.modals.deleteDir = false;
    closeModal("deleteDirModalOverlay");
  });

  el("filterInput").addEventListener("input", (e) => {
    FilterState.text = e.target.value;
    FilterState.active = !!FilterState.text;
    el("clearFilterBtn").disabled = !FilterState.active;
    applyFilterLocal();
  });
  el("clearFilterBtn").addEventListener("click", filterClear);

  const refreshBtnEl = el("refreshBtn");
  if (refreshBtnEl)
    refreshBtnEl.addEventListener("click", () =>
      listPrefix(NavigationState.currentPrefix, null, true)
    );

  el("loadMoreBtn").addEventListener("click", async () => {
    const token = ListingState.nextContinuationToken;
    if (token) {
      const prevScroll = window.scrollY;
      await listPrefix(NavigationState.currentPrefix, token, false);
      window.scrollTo({ top: prevScroll, behavior: "auto" });
    }
  });

  el("selectAllPage").addEventListener("change", (e) => {
    const selectAll = e.target.checked;
    SelectionState.selectAllPage = selectAll;
    const rows = el("rows").children;
    for (const row of rows) {
      if (row.style.display === "none") continue;
      const checkbox = row.querySelector("input[type='checkbox']");
      if (!checkbox) continue;

      // Reflect header toggle in per-row checkbox
      checkbox.checked = selectAll;

      const isFolder = row.dataset.entryType === "folder";
      const fullPath = computeRowFullPath(row);
      if (!fullPath) continue;

      if (selectAll) {
        if (isFolder) SelectionState.selectedPrefixes.add(fullPath);
        else SelectionState.selectedKeys.add(fullPath);
      } else {
        if (isFolder) SelectionState.selectedPrefixes.delete(fullPath);
        else SelectionState.selectedKeys.delete(fullPath);
      }
    }
    updateSelectionUI();
  });

  // Info modal bindings
  const infoFabEl = el("infoFab");
  if (infoFabEl) {
    infoFabEl.hidden = false;
    infoFabEl.addEventListener("click", () => {
      openInfoPanel();
    });
  }
  const closeInfoBtn = el("closeInfoModalBtn");
  if (closeInfoBtn) {
    closeInfoBtn.addEventListener("click", () => {
      UIState.modals.info = false;
      closeInfoPanel();
    });
  }
  const infoCloseBtnFooter = el("infoCloseBtn");
  if (infoCloseBtnFooter) {
    infoCloseBtnFooter.addEventListener("click", () => {
      UIState.modals.info = false;
      closeInfoPanel();
    });
  }
  const copyIamBtn = el("copyIamPolicyBtn");
  if (copyIamBtn) {
    copyIamBtn.addEventListener("click", async () => {
      try {
        await copyTextById("iamPolicyBlock");
        showToast("Copied", "IAM Policy copied to clipboard.");
      } catch (err) {
        showToast("Copy Failed", err?.message || String(err));
      }
    });
  }
  const copyCorsBtn = el("copyCorsBtn");
  if (copyCorsBtn) {
    copyCorsBtn.addEventListener("click", async () => {
      try {
        await copyTextById("corsBlock");
        showToast("Copied", "CORS config copied to clipboard.");
      } catch (err) {
        showToast("Copy Failed", err?.message || String(err));
      }
    });
  }

  // Move feature bindings
  const moveBtn = el("moveBtn");
  if (moveBtn) {
    moveBtn.addEventListener("click", () => openMovePickerModal());
  }
  const moveSelectBtn = el("movePickerSelectBtn");
  if (moveSelectBtn) {
    moveSelectBtn.addEventListener("click", async () => {
      try {
        const keys = Array.from(SelectionState.selectedKeys);
        const dest = MoveState.destPrefix || "";
        const conflicts = await preflightMoveConflicts(keys, dest);
        MoveState.conflicts = conflicts;
        openMoveConfirmModal(keys, dest, conflicts);
        UIState.modals.movePicker = false;
        closeModal("movePickerModalOverlay");
      } catch (err) {
        showToast("Move Preflight Failed", `${escapeHTML(err.message || String(err))}`);
      }
    });
  }
  const movePickerCancelBtn = el("movePickerCancelBtn");
  if (movePickerCancelBtn) {
    movePickerCancelBtn.addEventListener("click", () => {
      UIState.modals.movePicker = false;
      closeModal("movePickerModalOverlay");
    });
  }
  const closeMovePickerModalBtn = el("closeMovePickerModalBtn");
  if (closeMovePickerModalBtn) {
    closeMovePickerModalBtn.addEventListener("click", () => {
      UIState.modals.movePicker = false;
      closeModal("movePickerModalOverlay");
    });
  }

  const moveConfirmOverwriteBtn = el("moveConfirmOverwriteBtn");
  if (moveConfirmOverwriteBtn) {
    moveConfirmOverwriteBtn.addEventListener("click", async () => {
      const keys = Array.from(SelectionState.selectedKeys);
      await performBulkMove(keys, MoveState.destPrefix || "");
    });
  }
  const moveConfirmBackBtn = el("moveConfirmBackBtn");
  if (moveConfirmBackBtn) {
    moveConfirmBackBtn.addEventListener("click", () => {
      UIState.modals.moveConfirm = false;
      closeModal("moveConfirmModalOverlay");
      UIState.modals.movePicker = true;
      openModal("movePickerModalOverlay", "movePickerModal");
      renderMovePicker();
    });
  }
  const moveConfirmCancelBtn = el("moveConfirmCancelBtn");
  if (moveConfirmCancelBtn) {
    moveConfirmCancelBtn.addEventListener("click", () => {
      UIState.modals.moveConfirm = false;
      closeModal("moveConfirmModalOverlay");
    });
  }
  const closeMoveConfirmModalBtn = el("closeMoveConfirmModalBtn");
  if (closeMoveConfirmModalBtn) {
    closeMoveConfirmModalBtn.addEventListener("click", () => {
      UIState.modals.moveConfirm = false;
      closeModal("moveConfirmModalOverlay");
    });
  }

  const moveRetryFailedBtn = el("moveRetryFailedBtn");
  if (moveRetryFailedBtn) {
    moveRetryFailedBtn.addEventListener("click", async () => {
      const items = Array.from(el("moveFailureList")?.querySelectorAll("li") || []);
      const failedKeys = items.map((li) => li.dataset.key).filter(Boolean);
      if (failedKeys.length) {
        await performBulkMove(failedKeys, MoveState.destPrefix || "");
      }
    });
  }
  const moveProgressCancelBtn = el("moveProgressCancelBtn");
  if (moveProgressCancelBtn) {
    moveProgressCancelBtn.addEventListener("click", () => {
      UIState.modals.moveProgress = false;
      closeModal("moveProgressModalOverlay");
    });
  }
  const closeMoveProgressModalBtn = el("closeMoveProgressModalBtn");
  if (closeMoveProgressModalBtn) {
    closeMoveProgressModalBtn.addEventListener("click", () => {
      UIState.modals.moveProgress = false;
      closeModal("moveProgressModalOverlay");
    });
  }

  // Download feature bindings
  const downloadBtn = el("downloadBtn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => startMultiDownload());
  }
  const downloadRetryFailedBtn = el("downloadRetryFailedBtn");
  if (downloadRetryFailedBtn) {
    downloadRetryFailedBtn.addEventListener("click", async () => {
      const items = Array.from(el("downloadFailureList")?.querySelectorAll("li") || []);
      const failed = items.map((li) => li.dataset.key).filter(Boolean);
      if (failed.length) {
        await retryFailedDownloads(failed);
      }
    });
  }
  const downloadProgressCancelBtn = el("downloadProgressCancelBtn");
  if (downloadProgressCancelBtn) {
    downloadProgressCancelBtn.addEventListener("click", () => {
      UIState.modals.downloadProgress = false;
      closeModal("downloadProgressModalOverlay");
    });
  }
  const closeDownloadProgressModalBtn = el("closeDownloadProgressModalBtn");
  if (closeDownloadProgressModalBtn) {
    closeDownloadProgressModalBtn.addEventListener("click", () => {
      UIState.modals.downloadProgress = false;
      closeModal("downloadProgressModalOverlay");
    });
  }
}

// Initialization
function init() {
  // Reflect focus outline color from Config
  try {
    document.documentElement.style.setProperty("--focus", Config.uiFocusOutlineColor);
  } catch {}
  bindEvents();
  validateConnectForm(false);
}
init();

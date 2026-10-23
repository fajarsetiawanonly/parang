/**
 * ============================================================================
 * KDKMP PARANG — Dashboard Penjualan, Stok & Logistik
 * Core Application Engine & SPA Controller
 * ============================================================================
 */

// ============================================================================
// HARDCODED DEFAULT CONFIGURATIONS (Baku & Otomatis)
// ============================================================================
const DEFAULT_CONFIG = {
  CORE_APP_URL: "https://docs.google.com/spreadsheets/d/1AzFJskpym-jtj0USiDyX6WgWrol4JPFovNlBHCWW00g/edit?usp=sharing",
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxSLX_TLrB2mfuncaqrVW2f7lbIGrx6f5hsbKloVf5tJmYbhcRmraAQ-VW68rhIACPzFw/exec",
  DRIVE_FOLDER_URL: "https://drive.google.com/drive/folders/1b6OuJcrb8osa1VGVs9BEB3yySszrTkWj?usp=drive_link",
  DATABASES: {
    stock_opname: "https://docs.google.com/spreadsheets/d/18u-hFXEnEzPq2ZlHIeG09QDq0QDjsyNb/edit?usp=drive_link",
    daftar_harga: "https://docs.google.com/spreadsheets/d/1bxh0Ji02UaUqQztJn566lMuG10CWfwL6/edit?usp=drive_link",
    faktur_logistik: ""
  }
};

// ============================================================================
// SISTEM OTORITAS & PENGGUNA (ADMIN & ASMEN)
// ============================================================================
const USERS_DB = {
  admin: {
    username: "admin",
    password: "admin123",
    name: "MANAGER",
    role: "admin",
    roleLabel: "ADMIN",
    allowedSections: ["overview", "products", "producers", "stock", "logistics"]
  },
  asmen: {
    username: "parang",
    password: "password",
    name: "ASISTEN MANAGER",
    role: "asmen",
    roleLabel: "ASMEN",
    allowedSections: ["stock", "logistics"] // Asmen hanya akses Stok Opname & Faktur
  }
};

// Global App State
const AppState = {
  currentUser: null, // Diinisialisasi melalui AuthManager.init()
  activeSection: 'overview',
  activePeriod: 'all',
  config: {
    coreAppUrl: DEFAULT_CONFIG.CORE_APP_URL,
    scriptUrl: DEFAULT_CONFIG.SCRIPT_URL,
    driveFolderUrl: DEFAULT_CONFIG.DRIVE_FOLDER_URL,
    databaseOverrides: {
      stock_opname: '',
      daftar_harga: '',
      faktur_logistik: ''
    },
    lastSync: null
  },
  databasesCatalog: [],
  priceList: new Map(), // productName -> { producer, price }
  products: [],         // consolidated list of products with metrics
  stockDates: [],       // sorted list of stock opname date strings (DD-MM-YYYY)
  selectedStockDate: '',
  stockRecords: [],     // raw stock opname records
  salesRecords: [],     // computed sales deltas between opnames
  invoices: [],         // logistics faktur headers + items
  charts: {
    revenueTrend: null,
    topProducts: null,
    producerRevenue: null,
    qtyTrend: null,
    producerComparison: null,
    producerShare: null
  },
  logisticsForm: {
    stbPhoto: null,           // { file, base64, name }
    otherDocsPhotos: []       // array of { file, base64, name, id }
  },
  productsTablePagination: {
    page: 1,
    perPage: 15,
    search: '',
    producer: '',
    sortBy: 'revenue_desc'
  }
};

/* ============================================================================
   INDEXEDDB STORAGE ENGINE (kdkmp_dashboard_db)
   ============================================================================ */
const DB = {
  dbName: 'kdkmp_dashboard_db',
  version: 1,
  instance: null,

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        // 1. Config store
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }
        // 2. Core App Catalog store
        if (!db.objectStoreNames.contains('databases_catalog')) {
          db.createObjectStore('databases_catalog', { keyPath: 'key_database' });
        }
        // 3. Products Master store
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'nama_produk' });
        }
        // 4. Stock Opname History
        if (!db.objectStoreNames.contains('stock_history')) {
          const stockStore = db.createObjectStore('stock_history', { keyPath: 'id', autoIncrement: true });
          stockStore.createIndex('tgl_opname', 'tgl_opname', { unique: false });
          stockStore.createIndex('nama_produk', 'nama_produk', { unique: false });
        }
        // 5. Computed Sales Records
        if (!db.objectStoreNames.contains('sales_records')) {
          const salesStore = db.createObjectStore('sales_records', { keyPath: 'id', autoIncrement: true });
          salesStore.createIndex('tgl_penjualan', 'tgl_penjualan', { unique: false });
          salesStore.createIndex('nama_produk', 'nama_produk', { unique: false });
        }
        // 6. Logistics Invoices
        if (!db.objectStoreNames.contains('invoices')) {
          const invStore = db.createObjectStore('invoices', { keyPath: 'id_faktur' });
          invStore.createIndex('tgl_diterima', 'tgl_diterima', { unique: false });
          invStore.createIndex('pengirim', 'pengirim', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.instance = e.target.result;
        resolve(this.instance);
      };

      request.onerror = (e) => {
        console.error('IndexedDB Error:', e.target.error);
        reject(e.target.error);
      };
    });
  },

  async set(storeName, data) {
    if (!this.instance) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.instance.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async get(storeName, key) {
    if (!this.instance) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.instance.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getAll(storeName) {
    if (!this.instance) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.instance.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async clear(storeName) {
    if (!this.instance) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.instance.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  async bulkPut(storeName, items) {
    if (!this.instance) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.instance.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      items.forEach(item => store.put(item));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async resetAll() {
    const stores = ['config', 'databases_catalog', 'products', 'stock_history', 'sales_records', 'invoices'];
    for (const store of stores) {
      await this.clear(store);
    }
  }
};

/* ============================================================================
   UI NOTIFICATION & HELPER UTILITIES
   ============================================================================ */
function showToast(title, message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: 'fa-circle-check',
    error: 'fa-triangle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  toast.innerHTML = `
    <i class="fa-solid ${iconMap[type] || 'fa-circle-info'} toast-icon"></i>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close">&times;</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

function formatRupiah(amount) {
  const num = Math.round(Number(amount) || 0);
  return 'Rp ' + num.toLocaleString('id-ID');
}

function formatNumber(amount) {
  return (Number(amount) || 0).toLocaleString('id-ID');
}

/**
 * Intelligent Indonesian Currency Cleaner
 * Converts: "Rp 10.900,00", "Rp. 15.000", "10,900.00", "12500" -> 12500 (number)
 */
function cleanCurrency(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  
  let str = String(val).trim().toUpperCase();
  // Remove currency labels
  str = str.replace(/RP\.?/g, '').trim();

  // If contains commas and periods, decide whether comma is decimal
  // Indonesian format: 15.000,50 -> dot is thousands, comma is decimal
  if (str.includes('.') && str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    // If only comma, check if it looks like decimal or thousand separator
    const parts = str.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      str = parts[0] + '.' + parts[1];
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (str.includes('.')) {
    // Indonesian thousand separator: "15.000"
    const parts = str.split('.');
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      str = str.replace(/\./g, '');
    }
  }

  const cleaned = parseFloat(str.replace(/[^0-9.-]/g, ''));
  return isNaN(cleaned) ? 0 : cleaned;
}

/**
 * Date Normalizer: Converts DD-MM-YYYY, DD/MM/YYYY, DDMMYY, or YYYY-MM-DD to standard Date
 */
function parseDateString(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();

  // ISO format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // DD-MM-YYYY or D-M-YYYY or DD/MM/YY or D-M-YY
  const delimiterMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (delimiterMatch) {
    let day = parseInt(delimiterMatch[1], 10);
    let month = parseInt(delimiterMatch[2], 10) - 1;
    let year = parseInt(delimiterMatch[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }

  // 6 digits: DDMMYY (e.g. 011026) or D-M-YYYY (e.g. 772026)
  if (/^\d{6}$/.test(str)) {
    if (str.endsWith('2026') || str.endsWith('2025') || str.endsWith('2024')) {
      const day = parseInt(str[0], 10);
      const month = parseInt(str[1], 10) - 1;
      const year = parseInt(str.substring(2), 10);
      return new Date(year, month, day);
    } else {
      const day = parseInt(str.substring(0, 2), 10);
      const month = parseInt(str.substring(2, 4), 10) - 1;
      const year = parseInt(str.substring(4, 6), 10) + 2000;
      return new Date(year, month, day);
    }
  }

  // 5 digits: e.g. 24926 (24-9-26) or 41026 (4-10-26)
  if (/^\d{5}$/.test(str)) {
    const yr = parseInt(str.substring(3), 10) + 2000;
    const d1 = parseInt(str.substring(0, 2), 10);
    const m1 = parseInt(str.substring(2, 3), 10) - 1;
    if (d1 >= 1 && d1 <= 31 && m1 >= 0 && m1 <= 11) {
      return new Date(yr, m1, d1);
    }
    const d2 = parseInt(str.substring(0, 1), 10);
    const m2 = parseInt(str.substring(1, 3), 10) - 1;
    if (d2 >= 1 && d2 <= 9 && m2 >= 0 && m2 <= 11) {
      return new Date(yr, m2, d2);
    }
  }

  // 4 digits: e.g. 4826 (4-8-26)
  if (/^\d{4}$/.test(str)) {
    const day = parseInt(str[0], 10);
    const month = parseInt(str[1], 10) - 1;
    const year = parseInt(str.substring(2), 10) + 2000;
    return new Date(year, month, day);
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function formatDateDisplay(dateObj) {
  if (!dateObj) return '-';
  if (typeof dateObj === 'string') dateObj = parseDateString(dateObj) || new Date(dateObj);
  if (isNaN(dateObj.getTime())) return '-';

  return dateObj.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function formatDateStandard(dateObj) {
  if (!dateObj) return '';
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}-${m}-${y}`;
}

/**
 * Check if a date string is expiring soon, expired, or safe
 */
function checkExpiryStatus(expDateStr) {
  if (!expDateStr) return { status: 'none', label: 'Tanpa Exp', badgeClass: 'badge-subtle', daysDiff: 9999 };
  
  const expDate = parseDateString(expDateStr);
  if (!expDate) return { status: 'none', label: 'Format Tgl Tidak Valid', badgeClass: 'badge-subtle', daysDiff: 9999 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expDate.setHours(0, 0, 0, 0);

  const diffTime = expDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      status: 'expired',
      label: `Kedaluwarsa (${Math.abs(diffDays)} hari lalu)`,
      badgeClass: 'badge-red',
      daysDiff: diffDays
    };
  } else if (diffDays <= 30) {
    return {
      status: 'critical',
      label: `Kritis: ${diffDays} hari lagi`,
      badgeClass: 'badge-yellow',
      daysDiff: diffDays
    };
  } else {
    return {
      status: 'safe',
      label: `Aman (${diffDays} hari lagi)`,
      badgeClass: 'badge-green',
      daysDiff: diffDays
    };
  }
}

/**
 * Extracts Google Spreadsheet ID from a link
 */
function extractSpreadsheetId(urlOrId) {
  if (!urlOrId) return '';
  const str = String(urlOrId).trim();
  const match = str.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  // If it's already an ID
  if (/^[a-zA-Z0-9-_]{20,}$/.test(str)) return str;
  return str;
}

/* ============================================================================
   CLIENT-SIDE IMAGE COMPRESSION (HTML5 Canvas -> Base64)
   ============================================================================ */
async function compressImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file.type.match(/image.*/)) {
      return reject(new Error('File yang dipilih bukan gambar'));
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;

      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const base64Data = canvas.toDataURL('image/jpeg', quality);
        resolve({
          base64: base64Data,
          fileName: file.name,
          width,
          height,
          sizeBefore: file.size,
          sizeAfter: Math.round(base64Data.length * (3/4))
        });
      };

      img.onerror = (err) => reject(err);
    };

    reader.onerror = (err) => reject(err);
  });
}

/* ============================================================================
   CORE APPLICATION CALCULATION ENGINE
   ============================================================================ */

/**
 * Recomputes Sales Records by comparing consecutive Stock Opname sheets
 * If prevTotal - currTotal > 0, the difference is sold quantity.
 */
function computeSalesFromStock(stockRecords, priceListMap) {
  // Group stock records by date
  const byDate = new Map();
  stockRecords.forEach(rec => {
    if (!byDate.has(rec.tgl_opname)) {
      byDate.set(rec.tgl_opname, new Map());
    }
    byDate.get(rec.tgl_opname).set(rec.nama_produk, rec);
  });

  // Sort dates chronologically
  const sortedDates = Array.from(byDate.keys()).sort((a, b) => {
    const da = parseDateString(a) || new Date(0);
    const db = parseDateString(b) || new Date(0);
    return da - db;
  });

  const sales = [];

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = sortedDates[i - 1];
    const currDate = sortedDates[i];
    const prevMap = byDate.get(prevDate);
    const currMap = byDate.get(currDate);

    currMap.forEach((currItem, productName) => {
      const prevItem = prevMap.get(productName);
      if (prevItem) {
        const delta = prevItem.total_stok - currItem.total_stok;
        if (delta > 0) {
          const priceInfo = priceListMap.get(productName) || { producer: 'Umum', price: 0 };
          sales.push({
            tgl_penjualan: currDate,
            nama_produk: productName,
            produsen: priceInfo.producer || 'Umum',
            qty_sold: delta,
            price: priceInfo.price || 0,
            revenue: delta * (priceInfo.price || 0)
          });
        }
      }
    });
  }

  return { sales, sortedDates };
}

/**
 * Consolidate Product Master with metrics:
 * Latest known stock, total qty sold, total revenue
 */
function consolidateProducts(priceListMap, stockRecords, salesRecords, sortedDates) {
  const latestDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null;
  const latestStockMap = new Map();

  if (latestDate) {
    stockRecords.filter(r => r.tgl_opname === latestDate).forEach(r => {
      latestStockMap.set(r.nama_produk, r);
    });
  }

  // Aggregate sales by product
  const salesAgg = new Map();
  salesRecords.forEach(s => {
    if (!salesAgg.has(s.nama_produk)) {
      salesAgg.set(s.nama_produk, { qty: 0, revenue: 0 });
    }
    const cur = salesAgg.get(s.nama_produk);
    cur.qty += s.qty_sold;
    cur.revenue += s.revenue;
  });

  // Combine products from price list and any encountered in stock
  const allProductNames = new Set([
    ...Array.from(priceListMap.keys()),
    ...stockRecords.map(r => r.nama_produk)
  ]);

  const consolidated = [];
  allProductNames.forEach(name => {
    if (!name) return;
    const priceInfo = priceListMap.get(name) || { producer: 'Umum', price: 0 };
    const stockInfo = latestStockMap.get(name) || { stok_toko: 0, stok_gudang: 0, total_stok: 0 };
    const salesInfo = salesAgg.get(name) || { qty: 0, revenue: 0 };

    consolidated.push({
      nama_produk: name,
      produsen: priceInfo.producer || 'Umum',
      harga: priceInfo.price || 0,
      stok_toko: stockInfo.stok_toko || 0,
      stok_gudang: stockInfo.stok_gudang || 0,
      stok_terakhir: stockInfo.total_stok || 0,
      qty_terjual: salesInfo.qty,
      total_pendapatan: salesInfo.revenue
    });
  });

  return consolidated;
}

/* ============================================================================
   SPREADSHEET & SHEETJS PARSERS
   ============================================================================ */

/**
 * 1. Parser Database Core App
 * Supports both:
 * Format A (User's format): No | Nama Data (SO, Harga, Faktur) | Data (Google Sheet Link)
 * Format B: key_database | nama_database | link_spreadsheet | keterangan
 */
function parseCoreAppWorkbook(workbook) {
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('core')) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rawRows.length < 2) return [];

  // Find header row (either row 0 or within first 5 rows)
  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(rawRows.length, 5); r++) {
    const row = (rawRows[r] || []).map(c => String(c || '').trim().toLowerCase());
    if (row.some(c => c.includes('nama data') || c.includes('nama_database') || c.includes('key_database') || c === 'data')) {
      headerRowIdx = r;
      break;
    }
  }

  const catalog = [];
  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length < 2) continue;

    const cells = row.map(c => String(c || '').trim());
    const link = cells.find(c => c.startsWith('http://') || c.startsWith('https://')) || '';

    // Search for label name (skip numeric index)
    let label = '';
    for (let c = 0; c < cells.length; c++) {
      const val = cells[c];
      if (val && !val.startsWith('http') && isNaN(Number(val))) {
        label = val;
        break;
      }
    }
    if (!label && cells[0]) label = cells[0];

    const lowerLabel = label.toLowerCase();
    let key = '';
    let displayName = label;

    if (lowerLabel === 'so' || lowerLabel.includes('stok') || lowerLabel.includes('opname')) {
      key = 'stock_opname';
      displayName = 'Database Stok Opname (SO)';
    } else if (lowerLabel === 'harga' || lowerLabel.includes('price')) {
      key = 'daftar_harga';
      displayName = 'Database Master Daftar Harga';
    } else if (lowerLabel === 'faktur' || lowerLabel.includes('logistik') || lowerLabel.includes('invoice')) {
      key = 'faktur_logistik';
      displayName = 'Database Faktur & Logistik';
    } else {
      key = lowerLabel.replace(/[^a-z0-9_]/g, '_');
    }

    if (key) {
      catalog.push({
        key_database: key,
        nama_database: displayName,
        link_spreadsheet: link,
        keterangan: cells.find(c => c !== label && c !== link && isNaN(Number(c))) || ''
      });
    }
  }

  return catalog;
}

/**
 * 2. Parser Daftar Harga
 * Columns: PRODUSEN | Nama Produk | Harga
 * Handles merged/grouped producers across 262+ items (SAYAP MAS, INDOFOOD, UNILEVER, dll.)
 */
function parsePriceListWorkbook(workbook) {
  const priceMap = new Map();
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return priceMap;

  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rawRows.length === 0) return priceMap;

  // Smart header detection
  let headerRowIdx = -1;
  let prodIdx = -1, nameIdx = -1, priceIdx = -1;

  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const row = rawRows[r] || [];
    const lower = row.map(c => String(c || '').trim().toLowerCase());
    
    const pIdx = lower.findIndex(c => c.includes('produsen') || c.includes('supplier') || c.includes('distributor'));
    const nIdx = lower.findIndex(c => c.includes('produk') || c.includes('barang') || c.includes('item'));
    const prIdx = lower.findIndex(c => c.includes('harga') || c.includes('price'));

    if (nIdx !== -1 && prIdx !== -1) {
      headerRowIdx = r;
      prodIdx = pIdx;
      nameIdx = nIdx;
      priceIdx = prIdx;
      break;
    }
  }

  // Fallback indices if header not recognized
  if (headerRowIdx === -1) {
    headerRowIdx = 0;
    prodIdx = 0;
    nameIdx = 1;
    priceIdx = 2;
  }

  let currentProducer = 'Umum';
  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row) continue;

    const productName = String(row[nameIdx] || '').trim();
    if (!productName || productName.toLowerCase() === 'nama produk' || productName.toLowerCase() === 'total') continue;

    if (prodIdx !== -1 && row[prodIdx] && String(row[prodIdx]).trim() !== '') {
      currentProducer = String(row[prodIdx]).trim();
    }

    const price = cleanCurrency(row[priceIdx]);

    priceMap.set(productName, {
      producer: currentProducer,
      price: price
    });
  }

  return priceMap;
}

/**
 * 3. Parser Stock Opname
 * Multi-sheet with dynamic date tabs (DD-MM-YYYY, DD/MM/YY, D-M-YY, etc.)
 * Row headers: PRODUSEN | Nama Produk | Stok Groceries | Stok Warehouse | Total | ... | tanggal exiperd
 */
function parseStockOpnameWorkbook(workbook) {
  const stockRecords = [];

  workbook.SheetNames.forEach(sheetName => {
    // Validate if sheet name represents a date
    const parsedDate = parseDateString(sheetName);
    if (!parsedDate) return;

    const stdDateStr = formatDateStandard(parsedDate);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (rawRows.length < 6) return;

    // Detect header row index
    let startRow = 6;
    for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
      const row = (rawRows[r] || []).map(c => String(c || '').trim().toLowerCase());
      if (row.some(c => c.includes('nama produk') || c.includes('stok groceries') || c.includes('total'))) {
        startRow = r + 1;
        break;
      }
    }

    let currentProducer = 'Umum';
    for (let r = startRow; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row) continue;

      const productName = String(row[1] || '').trim();
      if (!productName || productName.toLowerCase() === 'total' || productName.toLowerCase().includes('nama produk')) continue;

      if (row[0] && String(row[0]).trim() !== '') {
        currentProducer = String(row[0]).trim();
      }

      const stokToko = Number(row[2]) || 0;
      const stokGudang = Number(row[3]) || 0;
      const totalStok = (row[4] !== undefined && row[4] !== null && row[4] !== '') 
        ? Number(row[4]) 
        : (stokToko + stokGudang);

      const expiredDate = row[9] ? String(row[9]).trim() : '';

      stockRecords.push({
        tgl_opname: stdDateStr,
        produsen: currentProducer,
        nama_produk: productName,
        stok_toko: stokToko,
        stok_gudang: stokGudang,
        total_stok: totalStok,
        tgl_expired: expiredDate
      });
    }
  });

  return stockRecords;
}

/**
 * 4. Parser Faktur Logistik
 * Sheets: Faktur_Header & Faktur_Detail
 */
function parseLogisticsWorkbook(workbook) {
  const headerSheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('header')) || workbook.SheetNames[0];
  const detailSheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('detail')) || workbook.SheetNames[1];

  const headersSheet = workbook.Sheets[headerSheetName];
  const detailsSheet = detailSheetName ? workbook.Sheets[detailSheetName] : null;

  if (!headersSheet) return [];

  const rawHeaders = XLSX.utils.sheet_to_json(headersSheet);
  const rawDetails = detailsSheet ? XLSX.utils.sheet_to_json(detailsSheet) : [];

  // Group details by id_faktur
  const detailsMap = new Map();
  rawDetails.forEach(d => {
    const id = String(d.id_faktur || '').trim();
    if (!id) return;
    if (!detailsMap.has(id)) detailsMap.set(id, []);
    detailsMap.get(id).push({
      nama_barang: String(d.nama_barang || '').trim(),
      qty_diterima: Number(d.qty_diterima) || 0,
      tgl_expired: String(d.tgl_expired || '').trim()
    });
  });

  const invoices = rawHeaders.map(h => {
    const id = String(h.id_faktur || '').trim();
    const items = detailsMap.get(id) || [];
    
    // Parse photos if array or comma separated
    let otherDocs = [];
    if (h.url_foto_dokumen_lain) {
      if (typeof h.url_foto_dokumen_lain === 'string') {
        try {
          otherDocs = JSON.parse(h.url_foto_dokumen_lain);
        } catch {
          otherDocs = h.url_foto_dokumen_lain.split(',').map(s => s.trim()).filter(Boolean);
        }
      } else if (Array.isArray(h.url_foto_dokumen_lain)) {
        otherDocs = h.url_foto_dokumen_lain;
      }
    }

    return {
      id_faktur: id,
      timestamp: h.timestamp || new Date().toISOString(),
      no_po: String(h.no_po || '-'),
      no_do: String(h.no_do || '-'),
      tgl_diterima: String(h.tgl_diterima || ''),
      pengirim: String(h.pengirim || 'Umum'),
      nopol_pengirim: String(h.nopol_pengirim || '-'),
      nama_sopir: String(h.nama_sopir || '-'),
      kontak_sopir: String(h.kontak_sopir || '-'),
      url_foto_stb: String(h.url_foto_stb || ''),
      url_foto_dokumen_lain: otherDocs,
      total_jenis_barang: Number(h.total_jenis_barang) || items.length,
      total_qty_diterima: Number(h.total_qty_diterima) || items.reduce((s, it) => s + (it.qty_diterima || 0), 0),
      items: items
    };
  });

  return invoices;
}

/* ============================================================================
   CENTRALIZED CLOUD SYNC CONTROLLER (CORE APP)
   ============================================================================ */

function appendSyncLog(msg, type = 'info') {
  const box = document.getElementById('syncLogBox');
  if (!box) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.appendChild(entry);
  box.scrollTop = box.scrollHeight;
}

function updateSyncProgress(percent, text) {
  const bar = document.getElementById('syncProgressBar');
  const txt = document.getElementById('syncProgressText');
  const pct = document.getElementById('syncProgressPercent');
  if (bar) bar.style.width = `${percent}%`;
  if (txt) txt.textContent = text;
  if (pct) pct.textContent = `${percent}%`;
}

/**
 * Downloads spreadsheet workbook via Google Apps Script Proxy or Direct Export
 */
async function fetchWorkbook(urlOrId, scriptUrl = '') {
  const sheetId = extractSpreadsheetId(urlOrId);

  // Strategy A: If Google Apps Script Web App URL is configured, use it to bypass browser CORS
  if (scriptUrl) {
    try {
      const apiUrl = `${scriptUrl}?action=getSpreadsheetData&sheetId=${encodeURIComponent(sheetId)}`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'success' && json.sheets) {
          // Construct sheetjs workbook from JSON tables
          const wb = XLSX.utils.book_new();
          for (const sName in json.sheets) {
            const ws = XLSX.utils.aoa_to_sheet(json.sheets[sName]);
            XLSX.utils.book_append_sheet(wb, ws, sName);
          }
          return wb;
        }
      }
    } catch (e) {
      console.warn('Apps Script proxy fetch failed, falling back to direct export:', e);
    }
  }

  // Strategy B: Direct Google Sheet XLSX export link
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const response = await fetch(exportUrl);
  if (!response.ok) {
    throw new Error(`Gagal mengunduh file spreadsheet (${response.status} ${response.statusText}). Pastikan Spreadsheet berstatus publik.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return XLSX.read(arrayBuffer, { type: 'array' });
}

/**
 * Centralized Sync:
 * Reads Core App -> extracts stock_opname, daftar_harga, faktur_logistik -> parses -> saves to IndexedDB
 */
async function syncAllDatabases(coreAppUrl, scriptUrl) {
  coreAppUrl = coreAppUrl || AppState.config.coreAppUrl || DEFAULT_CONFIG.CORE_APP_URL;
  scriptUrl = scriptUrl || AppState.config.scriptUrl || DEFAULT_CONFIG.SCRIPT_URL;

  const progressContainer = document.getElementById('syncProgressContainer');
  if (progressContainer) progressContainer.style.display = 'block';

  const logBox = document.getElementById('syncLogBox');
  if (logBox) logBox.innerHTML = '';

  const syncDot = document.getElementById('liveSyncDot');
  if (syncDot) syncDot.className = 'status-dot syncing';

  try {
    updateSyncProgress(10, 'Menghubungkan ke Core App Spreadsheet...');
    appendSyncLog(`Memulai sinkronisasi terpusat via Core App (${coreAppUrl})...`);

    // 1. Fetch Core App
    let catalog = [];
    try {
      const coreWb = await fetchWorkbook(coreAppUrl, scriptUrl);
      catalog = parseCoreAppWorkbook(coreWb);
      AppState.databasesCatalog = catalog;
      await DB.bulkPut('databases_catalog', catalog);
      renderDetectedDatabases(catalog);
      appendSyncLog(`Core App berhasil dibaca! Menemukan ${catalog.length} database terdaftar.`, 'success');
    } catch (coreErr) {
      appendSyncLog(`Peringatan: Gagal membaca Core App (${coreErr.message}). Menggunakan katalog default / override.`, 'warning');
      catalog = AppState.databasesCatalog || [];
    }

    // 2. Fetch Price List (Prioritaskan Override User jika ada)
    updateSyncProgress(30, 'Mengunduh Database Daftar Harga...');
    const priceEntry = catalog.find(c => c.key_database === 'daftar_harga');
    const priceUrl = (AppState.config.databaseOverrides && AppState.config.databaseOverrides.daftar_harga) 
      ? AppState.config.databaseOverrides.daftar_harga 
      : (priceEntry ? priceEntry.link_spreadsheet : DEFAULT_CONFIG.DATABASES.daftar_harga);

    if (priceUrl) {
      appendSyncLog(`Mengambil Daftar Harga dari: ${priceUrl}`);
      const priceWb = await fetchWorkbook(priceUrl, scriptUrl);
      AppState.priceList = parsePriceListWorkbook(priceWb);
      appendSyncLog(`Daftar Harga selesai: ${AppState.priceList.size} produk termuat.`, 'success');
    } else {
      appendSyncLog('Katalog tidak memuat link "daftar_harga", menggunakan harga tersimpan.', 'log-entry');
    }

    // 3. Fetch Stock Opname (Prioritaskan Override User jika ada)
    updateSyncProgress(55, 'Mengunduh Database Stok Opname...');
    const stockEntry = catalog.find(c => c.key_database === 'stock_opname');
    const stockUrl = (AppState.config.databaseOverrides && AppState.config.databaseOverrides.stock_opname)
      ? AppState.config.databaseOverrides.stock_opname
      : (stockEntry ? stockEntry.link_spreadsheet : DEFAULT_CONFIG.DATABASES.stock_opname);

    if (stockUrl) {
      appendSyncLog(`Mengambil Stok Opname dari: ${stockUrl}`);
      const stockWb = await fetchWorkbook(stockUrl, scriptUrl);
      AppState.stockRecords = parseStockOpnameWorkbook(stockWb);
      appendSyncLog(`Stok Opname selesai: ${AppState.stockRecords.length} baris data tercatat.`, 'success');
    } else {
      appendSyncLog('Katalog tidak memuat link "stock_opname".', 'log-entry');
    }

    // 4. Fetch Logistics / Invoices (Prioritaskan Override User jika ada)
    updateSyncProgress(75, 'Mengunduh Database Faktur & Logistik...');
    const logEntry = catalog.find(c => c.key_database === 'faktur_logistik');
    const logUrl = (AppState.config.databaseOverrides && AppState.config.databaseOverrides.faktur_logistik)
      ? AppState.config.databaseOverrides.faktur_logistik
      : (logEntry ? logEntry.link_spreadsheet : DEFAULT_CONFIG.DATABASES.faktur_logistik);

    if (logUrl) {
      appendSyncLog(`Mengambil Faktur Logistik dari: ${logUrl}`);
      const logWb = await fetchWorkbook(logUrl, scriptUrl);
      AppState.invoices = parseLogisticsWorkbook(logWb);
      appendSyncLog(`Faktur Logistik selesai: ${AppState.invoices.length} faktur termuat.`, 'success');
    } else {
      appendSyncLog('Katalog tidak memuat link "faktur_logistik".', 'log-entry');
    }

    // 5. Calculate Sales & Consolidate Master
    updateSyncProgress(90, 'Mengkalkulasi delta stok & omset penjualan...');
    const { sales, sortedDates } = computeSalesFromStock(AppState.stockRecords, AppState.priceList);
    AppState.salesRecords = sales;
    AppState.stockDates = sortedDates;
    AppState.selectedStockDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : '';

    AppState.products = consolidateProducts(AppState.priceList, AppState.stockRecords, AppState.salesRecords, sortedDates);

    // Persist to IndexedDB
    await DB.clear('stock_history');
    await DB.bulkPut('stock_history', AppState.stockRecords);

    await DB.clear('sales_records');
    await DB.bulkPut('sales_records', AppState.salesRecords);

    await DB.clear('products');
    await DB.bulkPut('products', AppState.products);

    await DB.clear('invoices');
    await DB.bulkPut('invoices', AppState.invoices);

    AppState.config.coreAppUrl = coreAppUrl;
    AppState.config.scriptUrl = scriptUrl;
    AppState.config.lastSync = new Date().toISOString();
    await DB.set('config', { key: 'mainConfig', ...AppState.config });

    updateSyncProgress(100, 'Sinkronisasi Selesai Sepenuhnya!');
    appendSyncLog('Seluruh data berhasil disimpan ke IndexedDB lokal.', 'success');

    if (syncDot) syncDot.className = 'status-dot connected';
    updateLiveSyncLabel();
    renderAllViews();

    showToast('Sinkronisasi Sukses', 'Semua database Core App berhasil diperbarui!', 'success');

  } catch (err) {
    console.error('Sync Error:', err);
    appendSyncLog(`ERROR: ${err.message}`, 'error');
    if (syncDot) syncDot.className = 'status-dot';
    showToast('Gagal Sinkronisasi', err.message, 'error', 6000);
  }
}

/* ============================================================================
   UI RENDERING ENGINES
   ============================================================================ */

function renderAllViews() {
  renderSidebarStats();
  renderOverviewSection();
  renderProductsSection();
  renderProducersSection();
  renderStockSection();
  renderLogisticsSection();
  renderDatabaseStatusTab();
  populateFormProductSuggestions();
}

function updateLiveSyncLabel() {
  const lbl = document.getElementById('liveSyncLabel');
  const ts = document.getElementById('liveSyncTimestamp');
  if (AppState.config.lastSync) {
    if (lbl) lbl.textContent = 'Tersinkron Cloud';
    if (ts) ts.textContent = formatDateDisplay(AppState.config.lastSync) + ' ' + new Date(AppState.config.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    if (lbl) lbl.textContent = 'Database Lokal';
    if (ts) ts.textContent = 'Belum disinkronkan';
  }
}

function renderSidebarStats() {
  updateLiveSyncLabel();

  // Expired alert count
  let expiredCount = 0;
  AppState.invoices.forEach(inv => {
    (inv.items || []).forEach(it => {
      const exp = checkExpiryStatus(it.tgl_expired);
      if (exp.status === 'expired' || exp.status === 'critical') expiredCount++;
    });
  });

  const expBadge = document.getElementById('expiredBadge');
  if (expBadge) {
    if (expiredCount > 0) {
      expBadge.textContent = expiredCount;
      expBadge.style.display = 'inline-block';
    } else {
      expBadge.style.display = 'none';
    }
  }
}

/**
 * Filter sales according to the active period segmented control
 */
function getFilteredSales() {
  if (AppState.activePeriod === 'all') return AppState.salesRecords;

  const now = new Date();
  return AppState.salesRecords.filter(s => {
    const d = parseDateString(s.tgl_penjualan);
    if (!d) return true;

    if (AppState.activePeriod === 'daily') {
      return d.toDateString() === now.toDateString();
    } else if (AppState.activePeriod === 'weekly') {
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return d >= oneWeekAgo && d <= now;
    } else if (AppState.activePeriod === 'monthly') {
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    return true;
  });
}

/**
 * 1. OVERVIEW SECTION (KPIs & 4 Chart.js charts)
 */
function renderOverviewSection() {
  const sales = getFilteredSales();

  // Calculate KPIs
  const totalRevenue = sales.reduce((sum, s) => sum + s.revenue, 0);
  const totalQty = sales.reduce((sum, s) => sum + s.qty_sold, 0);
  const uniqueActiveProducts = new Set(sales.map(s => s.nama_produk)).size;
  const uniqueDays = new Set(sales.map(s => s.tgl_penjualan)).size || 1;
  const dailyAvg = totalRevenue / uniqueDays;
  const dailyQtyAvg = Math.round(totalQty / uniqueDays);

  // Update DOM KPIs
  const elRev = document.getElementById('kpiTotalRevenue');
  const elQty = document.getElementById('kpiTotalQty');
  const elAct = document.getElementById('kpiActiveProducts');
  const elDaily = document.getElementById('kpiDailyAvg');

  if (elRev) elRev.textContent = formatRupiah(totalRevenue);
  if (elQty) elQty.innerHTML = `${formatNumber(totalQty)} <span class="unit">pcs</span>`;
  if (elAct) elAct.innerHTML = `${uniqueActiveProducts} <span class="unit">item</span>`;
  if (elDaily) elDaily.textContent = formatRupiah(dailyAvg);

  const elQtySub = document.getElementById('kpiQtySubtext');
  const elActSub = document.getElementById('kpiActiveProductsSubtext');
  if (elQtySub) elQtySub.textContent = `Rata-rata: ${formatNumber(dailyQtyAvg)} pcs / hari`;
  if (elActSub) elActSub.textContent = `Dari ${AppState.products.length} produk terdaftar`;

  // Render Charts
  renderOverviewCharts(sales);
}

function renderOverviewCharts(sales) {
  if (typeof Chart === 'undefined') return;

  // Chart 1: Revenue Trend Line
  // Group by date or week if date count > 45
  const byDate = new Map();
  sales.forEach(s => {
    byDate.set(s.tgl_penjualan, (byDate.get(s.tgl_penjualan) || 0) + s.revenue);
  });

  const sortedDates = Array.from(byDate.keys()).sort((a, b) => {
    const da = parseDateString(a) || new Date(0);
    const db = parseDateString(b) || new Date(0);
    return da - db;
  });

  const trendLabels = sortedDates.map(d => formatDateDisplay(d));
  const trendData = sortedDates.map(d => byDate.get(d));

  const ctxTrend = document.getElementById('chartRevenueTrend');
  if (ctxTrend) {
    if (AppState.charts.revenueTrend) AppState.charts.revenueTrend.destroy();

    AppState.charts.revenueTrend = new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels: trendLabels.length ? trendLabels : ['Tidak ada data'],
        datasets: [{
          label: 'Pendapatan (Rp)',
          data: trendData.length ? trendData : [0],
          borderColor: '#58a6ff',
          backgroundColor: 'rgba(88, 166, 255, 0.12)',
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointBackgroundColor: '#58a6ff',
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` Omset: ${formatRupiah(ctx.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(48, 54, 61, 0.4)' },
            ticks: { color: '#7d8590', font: { size: 11 } }
          },
          y: {
            grid: { color: 'rgba(48, 54, 61, 0.4)' },
            ticks: {
              color: '#7d8590',
              font: { size: 11 },
              callback: (val) => val >= 1000000 ? `${(val / 1000000).toFixed(1)}jt` : `${(val / 1000).toFixed(0)}rb`
            }
          }
        }
      }
    });
  }

  // Chart 2: Top 5 Products Doughnut
  const productRevMap = new Map();
  sales.forEach(s => {
    productRevMap.set(s.nama_produk, (productRevMap.get(s.nama_produk) || 0) + s.revenue);
  });

  const sortedTop = Array.from(productRevMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topLabels = sortedTop.map(t => t[0]);
  const topValues = sortedTop.map(t => t[1]);

  const ctxTop = document.getElementById('chartTopProducts');
  if (ctxTop) {
    if (AppState.charts.topProducts) AppState.charts.topProducts.destroy();

    AppState.charts.topProducts = new Chart(ctxTop, {
      type: 'doughnut',
      data: {
        labels: topLabels.length ? topLabels : ['Belum ada penjualan'],
        datasets: [{
          data: topValues.length ? topValues : [1],
          backgroundColor: ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#f85149'],
          borderColor: '#161b22',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#e6edf3', boxWidth: 12, font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${formatRupiah(ctx.raw)}`
            }
          }
        }
      }
    });
  }

  // Chart 3: Revenue per Producer (Horizontal Bar)
  const prodRevMap = new Map();
  sales.forEach(s => {
    prodRevMap.set(s.produsen, (prodRevMap.get(s.produsen) || 0) + s.revenue);
  });

  const sortedProd = Array.from(prodRevMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 7);

  const ctxProducer = document.getElementById('chartProducerRevenue');
  if (ctxProducer) {
    if (AppState.charts.producerRevenue) AppState.charts.producerRevenue.destroy();

    AppState.charts.producerRevenue = new Chart(ctxProducer, {
      type: 'bar',
      data: {
        labels: sortedProd.map(p => p[0]),
        datasets: [{
          label: 'Omset',
          data: sortedProd.map(p => p[1]),
          backgroundColor: 'rgba(63, 185, 80, 0.7)',
          borderColor: '#3fb950',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` Omset: ${formatRupiah(ctx.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(48, 54, 61, 0.4)' },
            ticks: {
              color: '#7d8590',
              callback: (val) => val >= 1000000 ? `${(val / 1000000).toFixed(1)}jt` : `${(val / 1000).toFixed(0)}rb`
            }
          },
          y: {
            grid: { display: false },
            ticks: { color: '#e6edf3', font: { size: 11 } }
          }
        }
      }
    });
  }

  // Chart 4: Qty Trend Bar
  const byDateQty = new Map();
  sales.forEach(s => {
    byDateQty.set(s.tgl_penjualan, (byDateQty.get(s.tgl_penjualan) || 0) + s.qty_sold);
  });

  const qtyLabels = sortedDates.map(d => formatDateDisplay(d));
  const qtyData = sortedDates.map(d => byDateQty.get(d));

  const ctxQty = document.getElementById('chartQtyTrend');
  if (ctxQty) {
    if (AppState.charts.qtyTrend) AppState.charts.qtyTrend.destroy();

    AppState.charts.qtyTrend = new Chart(ctxQty, {
      type: 'bar',
      data: {
        labels: qtyLabels.length ? qtyLabels : ['Tidak ada data'],
        datasets: [{
          label: 'Kuantitas Terjual (Pcs)',
          data: qtyData.length ? qtyData : [0],
          backgroundColor: 'rgba(188, 140, 255, 0.7)',
          borderColor: '#bc8cff',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` Terjual: ${formatNumber(ctx.raw)} pcs`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#7d8590', font: { size: 11 } }
          },
          y: {
            grid: { color: 'rgba(48, 54, 61, 0.4)' },
            ticks: { color: '#7d8590', font: { size: 11 } }
          }
        }
      }
    });
  }
}

/**
 * 2. PRODUCTS SECTION (Filterable, Sortable, Paginated Table)
 */
function renderProductsSection() {
  const tbody = document.getElementById('productsTableBody');
  const countLabel = document.getElementById('productsCountLabel');
  const producerFilter = document.getElementById('productProducerFilter');

  if (!tbody) return;

  // Populate producer dropdown filter
  const currentSelectedProd = producerFilter ? producerFilter.value : '';
  const producersSet = new Set(AppState.products.map(p => p.produsen).filter(Boolean));
  if (producerFilter && producerFilter.options.length <= 1) {
    producerFilter.innerHTML = '<option value="">Semua Produsen</option>';
    Array.from(producersSet).sort().forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      producerFilter.appendChild(opt);
    });
    producerFilter.value = currentSelectedProd;
  }

  // Filter & Search
  let filtered = [...AppState.products];

  const search = AppState.productsTablePagination.search.toLowerCase();
  if (search) {
    filtered = filtered.filter(p => p.nama_produk.toLowerCase().includes(search) || p.produsen.toLowerCase().includes(search));
  }

  const selectedProducer = AppState.productsTablePagination.producer;
  if (selectedProducer) {
    filtered = filtered.filter(p => p.produsen === selectedProducer);
  }

  // Sort
  const sortBy = AppState.productsTablePagination.sortBy;
  filtered.sort((a, b) => {
    if (sortBy === 'revenue_desc') return b.total_pendapatan - a.total_pendapatan;
    if (sortBy === 'revenue_asc') return a.total_pendapatan - b.total_pendapatan;
    if (sortBy === 'qty_desc') return b.qty_terjual - a.qty_terjual;
    if (sortBy === 'qty_asc') return a.qty_terjual - b.qty_terjual;
    if (sortBy === 'name_asc') return a.nama_produk.localeCompare(b.nama_produk);
    if (sortBy === 'price_desc') return b.harga - a.harga;
    return 0;
  });

  const totalFiltered = filtered.length;
  if (countLabel) countLabel.textContent = `Menampilkan ${totalFiltered} produk terdaftar`;

  // Pagination
  const { page, perPage } = AppState.productsTablePagination;
  const totalPages = Math.ceil(totalFiltered / perPage) || 1;
  const startIdx = (page - 1) * perPage;
  const pageItems = filtered.slice(startIdx, startIdx + perPage);

  // Highest revenue in filtered set for relative progress bar
  const maxRevenue = Math.max(...filtered.map(p => p.total_pendapatan), 1);

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 2.5rem; color: #7d8590;">Tidak ada produk yang cocok dengan pencarian atau filter.</td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map((p, idx) => {
      const rowNo = startIdx + idx + 1;
      const progressPercent = Math.min(Math.round((p.total_pendapatan / maxRevenue) * 100), 100);
      const stockBadge = p.stok_terakhir <= 5 
        ? `<span class="badge badge-red">${p.stok_terakhir} pcs (Menipis)</span>`
        : `<span class="badge badge-subtle">${p.stok_terakhir} pcs</span>`;

      return `
        <tr>
          <td>${rowNo}</td>
          <td><strong>${escapeHtml(p.nama_produk)}</strong></td>
          <td><span class="badge badge-accent">${escapeHtml(p.produsen)}</span></td>
          <td class="text-right">${formatRupiah(p.harga)}</td>
          <td class="text-right">${formatNumber(p.qty_terjual)} pcs</td>
          <td class="text-right">
            <div class="table-progress-wrap">
              <span>${formatRupiah(p.total_pendapatan)}</span>
              <div class="cell-progress-bar">
                <div class="cell-progress-fill" style="width: ${progressPercent}%;"></div>
              </div>
            </div>
          </td>
          <td class="text-right">${stockBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // Render Pagination Controls
  renderPaginationButtons('productsPagination', totalPages, page, (newPage) => {
    AppState.productsTablePagination.page = newPage;
    renderProductsSection();
  });
}

function renderPaginationButtons(containerId, totalPages, curPage, onPageClick) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<button class="page-btn" ${curPage === 1 ? 'disabled' : ''} data-page="${curPage - 1}"><i class="fa-solid fa-chevron-left"></i></button>`;

  const maxVisible = 5;
  let startPage = Math.max(1, curPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage + 1 < maxVisible) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="page-btn ${p === curPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }

  html += `<button class="page-btn" ${curPage === totalPages ? 'disabled' : ''} data-page="${curPage + 1}"><i class="fa-solid fa-chevron-right"></i></button>`;
  container.innerHTML = html;

  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.getAttribute('data-page'), 10);
      if (p >= 1 && p <= totalPages && p !== curPage) {
        onPageClick(p);
      }
    });
  });
}

/**
 * 3. PRODUCERS SECTION (Charts & Contribution % Matrix)
 */
function renderProducersSection() {
  const prodMap = new Map();

  AppState.products.forEach(p => {
    if (!prodMap.has(p.produsen)) {
      prodMap.set(p.produsen, { producer: p.produsen, itemCount: 0, totalQty: 0, totalRevenue: 0 });
    }
    const cur = prodMap.get(p.produsen);
    cur.itemCount++;
    cur.totalQty += p.qty_terjual;
    cur.totalRevenue += p.total_pendapatan;
  });

  const list = Array.from(prodMap.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  const grandTotalRevenue = list.reduce((s, it) => s + it.totalRevenue, 0) || 1;

  const badge = document.getElementById('totalProducersBadge');
  if (badge) badge.textContent = `${list.length} Produsen Terdaftar`;

  const tbody = document.getElementById('producersTableBody');
  if (tbody) {
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 2.5rem; color: #7d8590;">Belum ada data produsen.</td></tr>`;
    } else {
      tbody.innerHTML = list.map((item, idx) => {
        const sharePercent = ((item.totalRevenue / grandTotalRevenue) * 100).toFixed(1);
        return `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${escapeHtml(item.producer)}</strong></td>
            <td class="text-right">${item.itemCount} varian</td>
            <td class="text-right">${formatNumber(item.totalQty)} pcs</td>
            <td class="text-right" style="color: #58a6ff; font-weight: 600;">${formatRupiah(item.totalRevenue)}</td>
            <td>
              <div class="table-progress-wrap">
                <span style="min-width: 45px; text-align: right;">${sharePercent}%</span>
                <div class="cell-progress-bar" style="max-width: 110px;">
                  <div class="cell-progress-fill" style="width: ${sharePercent}%;"></div>
                </div>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Render Producer Charts
  if (typeof Chart === 'undefined') return;

  const top7 = list.slice(0, 7);

  // Producer Comparison Chart (Revenue vs Volume)
  const ctxComp = document.getElementById('chartProducerComparison');
  if (ctxComp) {
    if (AppState.charts.producerComparison) AppState.charts.producerComparison.destroy();

    AppState.charts.producerComparison = new Chart(ctxComp, {
      type: 'bar',
      data: {
        labels: top7.map(p => p.producer),
        datasets: [
          {
            label: 'Omset (Rp)',
            data: top7.map(p => p.totalRevenue),
            backgroundColor: 'rgba(88, 166, 255, 0.75)',
            borderColor: '#58a6ff',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Qty Terjual (Pcs)',
            data: top7.map(p => p.totalQty),
            backgroundColor: 'rgba(63, 185, 80, 0.75)',
            borderColor: '#3fb950',
            borderWidth: 1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#e6edf3', font: { size: 10 } }
          },
          y: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(48, 54, 61, 0.4)' },
            ticks: {
              color: '#58a6ff',
              callback: (val) => val >= 1000000 ? `${(val / 1000000).toFixed(1)}jt` : `${(val / 1000).toFixed(0)}rb`
            }
          },
          y1: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#3fb950' }
          }
        }
      }
    });
  }

  // Producer Share Doughnut
  const ctxShare = document.getElementById('chartProducerShare');
  if (ctxShare) {
    if (AppState.charts.producerShare) AppState.charts.producerShare.destroy();

    AppState.charts.producerShare = new Chart(ctxShare, {
      type: 'doughnut',
      data: {
        labels: top7.map(p => p.producer),
        datasets: [{
          data: top7.map(p => p.totalRevenue),
          backgroundColor: ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#f85149', '#39d353', '#db61a2'],
          borderColor: '#161b22',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#e6edf3', boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${formatRupiah(ctx.raw)}`
            }
          }
        }
      }
    });
  }
}

/**
 * 4. STOCK OPNAME SECTION (Date Selector, Search, 4 Stock KPIs, Table)
 */
function renderStockSection() {
  const dateSelect = document.getElementById('stockDateSelect');
  const searchInput = document.getElementById('stockSearchInput');
  const tbody = document.getElementById('stockTableBody');
  const countLabel = document.getElementById('stockCountLabel');

  if (!dateSelect || !tbody) return;

  // Populate Stock Dates Dropdown
  const prevSelectedDate = dateSelect.value;
  dateSelect.innerHTML = '<option value="">Pilih tanggal opname...</option>';
  AppState.stockDates.forEach(dt => {
    const opt = document.createElement('option');
    opt.value = dt;
    opt.textContent = `${dt} (${formatDateDisplay(dt)})`;
    dateSelect.appendChild(opt);
  });

  if (AppState.stockDates.includes(AppState.selectedStockDate)) {
    dateSelect.value = AppState.selectedStockDate;
  } else if (AppState.stockDates.length > 0) {
    AppState.selectedStockDate = AppState.stockDates[AppState.stockDates.length - 1];
    dateSelect.value = AppState.selectedStockDate;
  }

  const activeDate = dateSelect.value;

  // Find previous date index for comparison
  const dateIdx = AppState.stockDates.indexOf(activeDate);
  const prevDate = dateIdx > 0 ? AppState.stockDates[dateIdx - 1] : null;

  // Build map of previous date stocks
  const prevStockMap = new Map();
  if (prevDate) {
    AppState.stockRecords.filter(r => r.tgl_opname === prevDate).forEach(r => {
      prevStockMap.set(r.nama_produk, r.total_stok);
    });
  }

  // Filter current stock items
  let currentStocks = AppState.stockRecords.filter(r => r.tgl_opname === activeDate);
  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (searchTerm) {
    currentStocks = currentStocks.filter(r => r.nama_produk.toLowerCase().includes(searchTerm));
  }

  // Calculate Stock KPIs
  let totalStockValuation = 0;
  let lowStockCount = 0;

  currentStocks.forEach(r => {
    const priceInfo = AppState.priceList.get(r.nama_produk);
    const unitPrice = priceInfo ? priceInfo.price : 0;
    totalStockValuation += (r.total_stok * unitPrice);
    if (r.total_stok <= 5) lowStockCount++;
  });

  const elTot = document.getElementById('kpiStockTotalProducts');
  const elVal = document.getElementById('kpiStockValuation');
  const elLow = document.getElementById('kpiStockLow');
  const elDate = document.getElementById('kpiStockActiveDate');
  const elCompLabel = document.getElementById('kpiStockComparisonLabel');

  if (elTot) elTot.innerHTML = `${currentStocks.length} <span class="unit">item</span>`;
  if (elVal) elVal.textContent = formatRupiah(totalStockValuation);
  if (elLow) elLow.innerHTML = `${lowStockCount} <span class="unit">item</span>`;
  if (elDate) elDate.textContent = activeDate ? formatDateDisplay(activeDate) : '-';
  if (elCompLabel) {
    elCompLabel.textContent = prevDate ? `Dibandingkan opname ${prevDate}` : 'Opname pertama (belum ada pembanding)';
  }

  if (countLabel) countLabel.textContent = `Menampilkan ${currentStocks.length} baris data stok pada tanggal ${activeDate || '-'}`;

  if (currentStocks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2.5rem; color: #7d8590;">Tidak ada data stok untuk tanggal atau pencarian yang dipilih.</td></tr>`;
    return;
  }

  tbody.innerHTML = currentStocks.map((r, idx) => {
    const priceInfo = AppState.priceList.get(r.nama_produk);
    const unitPrice = priceInfo ? priceInfo.price : 0;
    const invValuation = r.total_stok * unitPrice;

    // Movement badge comparison
    let moveBadge = `<span class="badge badge-subtle">-</span>`;
    if (prevDate && prevStockMap.has(r.nama_produk)) {
      const prevQty = prevStockMap.get(r.nama_produk);
      const diff = r.total_stok - prevQty;
      if (diff < 0) {
        moveBadge = `<span class="badge badge-green"><i class="fa-solid fa-arrow-down"></i> Terjual ${Math.abs(diff)} pcs</span>`;
      } else if (diff > 0) {
        moveBadge = `<span class="badge badge-accent"><i class="fa-solid fa-arrow-up"></i> Masuk +${diff} pcs</span>`;
      } else {
        moveBadge = `<span class="badge badge-subtle">Tetap</span>`;
      }
    }

    const totalStokClass = r.total_stok <= 5 ? 'style="color: #f85149; font-weight: 700;"' : '';

    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${escapeHtml(r.nama_produk)}</strong></td>
        <td class="text-right">${formatNumber(r.stok_toko)}</td>
        <td class="text-right">${formatNumber(r.stok_gudang)}</td>
        <td class="text-right" ${totalStokClass}>${formatNumber(r.total_stok)} pcs</td>
        <td class="text-right">${formatRupiah(unitPrice)}</td>
        <td class="text-right">${formatRupiah(invValuation)}</td>
        <td class="text-center">${moveBadge}</td>
      </tr>
    `;
  }).join('');
}

/**
 * 5. LOGISTICS & INVOICES SECTION (Form & History)
 */
function renderLogisticsSection() {
  const tbody = document.getElementById('invoicesTableBody');
  const countBadge = document.getElementById('logisticsCountBadge');
  const searchInput = document.getElementById('logisticsSearchInput');
  const expFilter = document.getElementById('logisticsExpFilter');

  if (!tbody) return;

  // Calculate Logistics KPIs
  const totalInvoices = AppState.invoices.length;
  let totalQtyReceived = 0;
  let expiringSoonCount = 0;
  let latestDate = null;
  let latestSender = '-';

  AppState.invoices.forEach(inv => {
    totalQtyReceived += inv.total_qty_diterima;
    const invDate = parseDateString(inv.tgl_diterima);
    if (invDate && (!latestDate || invDate > latestDate)) {
      latestDate = invDate;
      latestSender = inv.pengirim;
    }

    (inv.items || []).forEach(it => {
      const exp = checkExpiryStatus(it.tgl_expired);
      if (exp.status === 'expired' || exp.status === 'critical') expiringSoonCount++;
    });
  });

  const elTotInv = document.getElementById('kpiLogisticsTotalInvoices');
  const elTotQty = document.getElementById('kpiLogisticsTotalQty');
  const elExp = document.getElementById('kpiLogisticsExpiringSoon');
  const elLatDate = document.getElementById('kpiLogisticsLatestDate');
  const elLatSend = document.getElementById('kpiLogisticsLatestSender');

  if (elTotInv) elTotInv.innerHTML = `${totalInvoices} <span class="unit">faktur</span>`;
  if (elTotQty) elTotQty.innerHTML = `${formatNumber(totalQtyReceived)} <span class="unit">pcs</span>`;
  if (elExp) elExp.innerHTML = `${expiringSoonCount} <span class="unit">item</span>`;
  if (elLatDate) elLatDate.textContent = latestDate ? formatDateDisplay(latestDate) : '-';
  if (elLatSend) elLatSend.textContent = latestSender;

  // Filter & Search
  let list = [...AppState.invoices];
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (query) {
    list = list.filter(inv => 
      inv.no_po.toLowerCase().includes(query) ||
      inv.no_do.toLowerCase().includes(query) ||
      inv.pengirim.toLowerCase().includes(query) ||
      inv.nama_sopir.toLowerCase().includes(query)
    );
  }

  const selectedExpFilter = expFilter ? expFilter.value : 'all';
  if (selectedExpFilter === 'critical') {
    list = list.filter(inv => 
      (inv.items || []).some(it => {
        const exp = checkExpiryStatus(it.tgl_expired);
        return exp.status === 'expired' || exp.status === 'critical';
      })
    );
  } else if (selectedExpFilter === 'safe') {
    list = list.filter(inv => 
      (inv.items || []).every(it => {
        const exp = checkExpiryStatus(it.tgl_expired);
        return exp.status === 'safe' || exp.status === 'none';
      })
    );
  }

  if (countBadge) countBadge.textContent = `${list.length} Faktur`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center" style="padding: 2.5rem; color: #7d8590;">Belum ada riwayat faktur yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(inv => {
    // Check item expired statuses inside invoice
    let hasExpired = false;
    let hasCritical = false;
    (inv.items || []).forEach(it => {
      const exp = checkExpiryStatus(it.tgl_expired);
      if (exp.status === 'expired') hasExpired = true;
      if (exp.status === 'critical') hasCritical = true;
    });

    let expBadge = `<span class="badge badge-green">Aman</span>`;
    if (hasExpired) {
      expBadge = `<span class="badge badge-red"><i class="fa-solid fa-triangle-exclamation"></i> Ada Expired</span>`;
    } else if (hasCritical) {
      expBadge = `<span class="badge badge-yellow"><i class="fa-solid fa-clock"></i> &le; 30 Hari</span>`;
    }

    const photoBadge = inv.url_foto_stb 
      ? `<span class="badge badge-accent"><i class="fa-solid fa-camera"></i> ${1 + (inv.url_foto_dokumen_lain || []).length} Foto</span>`
      : `<span class="badge badge-subtle">Tanpa Foto</span>`;

    return `
      <tr class="invoice-clickable-row" data-id="${escapeHtml(inv.id_faktur)}" style="cursor: pointer;" title="Klik untuk melihat detail lengkap & foto">
        <td><strong>${escapeHtml(inv.id_faktur)}</strong></td>
        <td>${formatDateDisplay(inv.tgl_diterima)}</td>
        <td>
          <div>PO: <code>${escapeHtml(inv.no_po)}</code></div>
          <div style="color: #7d8590; font-size: 0.75rem;">DO: <code>${escapeHtml(inv.no_do)}</code></div>
        </td>
        <td><span class="badge badge-subtle">${escapeHtml(inv.pengirim)}</span></td>
        <td>
          <div>${escapeHtml(inv.nama_sopir)}</div>
          <div style="color: #7d8590; font-size: 0.75rem;">${escapeHtml(inv.nopol_pengirim)}</div>
        </td>
        <td class="text-right">${inv.total_jenis_barang} item</td>
        <td class="text-right"><strong>${formatNumber(inv.total_qty_diterima)}</strong> pcs</td>
        <td class="text-center">${expBadge}</td>
        <td class="text-center">${photoBadge}</td>
        <td class="text-center">
          <button class="btn-sm btn-outline-accent btn-view-invoice" data-id="${escapeHtml(inv.id_faktur)}">
            <i class="fa-solid fa-eye"></i> Detail
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Bind Detail Buttons & Row Clicks
  tbody.querySelectorAll('.invoice-clickable-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const invId = row.getAttribute('data-id');
      const invoice = AppState.invoices.find(i => i.id_faktur === invId);
      if (invoice) openInvoiceDetailModal(invoice);
    });
  });
}

function openInvoiceDetailModal(inv) {
  document.getElementById('detIdFaktur').textContent = inv.id_faktur;
  document.getElementById('detTglDiterima').textContent = formatDateDisplay(inv.tgl_diterima);
  document.getElementById('detNoPo').textContent = inv.no_po;
  document.getElementById('detNoDo').textContent = inv.no_do;
  document.getElementById('detPengirim').textContent = inv.pengirim;
  document.getElementById('detNopol').textContent = inv.nopol_pengirim;
  document.getElementById('detNamaSopir').textContent = inv.nama_sopir;
  document.getElementById('detKontakSopir').textContent = inv.kontak_sopir;

  // Render Items Table
  const itemsTbody = document.getElementById('detItemsTableBody');
  if (itemsTbody) {
    if (!inv.items || inv.items.length === 0) {
      itemsTbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color: #7d8590;">Tidak ada rincian item.</td></tr>`;
    } else {
      itemsTbody.innerHTML = inv.items.map((it, idx) => {
        const exp = checkExpiryStatus(it.tgl_expired);
        return `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${escapeHtml(it.nama_barang)}</strong></td>
            <td class="text-right">${formatNumber(it.qty_diterima)} pcs</td>
            <td>${it.tgl_expired ? formatDateDisplay(it.tgl_expired) : '-'}</td>
            <td class="text-center"><span class="badge ${exp.badgeClass}">${exp.label}</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  // Render Photos Gallery
  const photosGrid = document.getElementById('detPhotosGallery');
  if (photosGrid) {
    photosGrid.innerHTML = '';
    const photos = [];
    if (inv.url_foto_stb) {
      photos.push({ url: inv.url_foto_stb, title: 'Foto STB (Surat Terima Barang)' });
    }
    (inv.url_foto_dokumen_lain || []).forEach((u, i) => {
      photos.push({ url: u, title: `Foto Dokumen #${i + 1}` });
    });

    if (photos.length === 0) {
      photosGrid.innerHTML = `<p style="color: #7d8590; font-size: 0.85rem;">Tidak ada bukti foto terlampir pada faktur ini.</p>`;
    } else {
      photos.forEach(p => {
        const card = document.createElement('div');
        card.className = 'detail-photo-card';
        card.innerHTML = `
          <img src="${p.url}" alt="${p.title}" loading="lazy">
          <div class="photo-card-label">${p.title}</div>
        `;
        card.addEventListener('click', () => {
          openLightbox(p.url, `${inv.id_faktur} — ${p.title}`);
        });
        photosGrid.appendChild(card);
      });
    }
  }

  const modal = document.getElementById('invoiceDetailModal');
  if (modal) modal.classList.add('active');
}

function openLightbox(imgSrc, caption) {
  const lightbox = document.getElementById('lightboxModal');
  const img = document.getElementById('lightboxImg');
  const cap = document.getElementById('lightboxCaption');
  if (lightbox && img) {
    img.src = imgSrc;
    if (cap) cap.textContent = caption || '';
    lightbox.classList.add('active');
  }
}

/* ============================================================================
   DYNAMIC LOGISTICS INPUT FORM CONTROLLER
   ============================================================================ */

function populateFormProductSuggestions() {
  const datalist = document.getElementById('productListSuggestions');
  const producerDatalist = document.getElementById('producerSuggestions');

  if (datalist) {
    datalist.innerHTML = '';
    AppState.products.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.nama_produk;
      datalist.appendChild(opt);
    });
  }

  if (producerDatalist) {
    producerDatalist.innerHTML = '';
    const producers = Array.from(new Set(AppState.products.map(p => p.produsen).filter(Boolean))).sort();
    producers.forEach(pr => {
      const opt = document.createElement('option');
      opt.value = pr;
      producerDatalist.appendChild(opt);
    });
  }
}

function addFormItemRow(name = '', qty = '', exp = '') {
  const tbody = document.getElementById('itemsInputTableBody');
  if (!tbody) return;

  const rowCount = tbody.querySelectorAll('tr').length + 1;
  const tr = document.createElement('tr');
  tr.className = 'dynamic-item-row';
  tr.innerHTML = `
    <td class="text-center row-num">${rowCount}</td>
    <td>
      <input type="text" class="input-item-name" list="productListSuggestions" placeholder="Ketik atau pilih nama produk" value="${escapeHtml(name)}" required>
    </td>
    <td>
      <input type="number" class="input-item-qty" placeholder="0" min="1" value="${qty}" required>
    </td>
    <td>
      <input type="date" class="input-item-exp" value="${exp}">
    </td>
    <td class="text-center">
      <button type="button" class="btn-delete-row" title="Hapus Baris"><i class="fa-solid fa-trash-can"></i></button>
    </td>
  `;

  // Delete row listener
  tr.querySelector('.btn-delete-row').addEventListener('click', () => {
    tr.remove();
    renumberFormItemRows();
    updateFormSummary();
  });

  // Input listeners for live calculation
  tr.querySelector('.input-item-qty').addEventListener('input', updateFormSummary);

  tbody.appendChild(tr);
  updateFormSummary();
}

function renumberFormItemRows() {
  const tbody = document.getElementById('itemsInputTableBody');
  if (!tbody) return;
  tbody.querySelectorAll('.dynamic-item-row').forEach((row, i) => {
    const numEl = row.querySelector('.row-num');
    if (numEl) numEl.textContent = i + 1;
  });
}

function updateFormSummary() {
  const tbody = document.getElementById('itemsInputTableBody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('.dynamic-item-row');
  let totalItems = 0;
  let totalQty = 0;

  rows.forEach(row => {
    const name = row.querySelector('.input-item-name').value.trim();
    const qty = parseInt(row.querySelector('.input-item-qty').value, 10) || 0;
    if (name) totalItems++;
    totalQty += qty;
  });

  const elTotItems = document.getElementById('summaryTotalItems');
  const elTotQty = document.getElementById('summaryTotalQty');
  if (elTotItems) elTotItems.textContent = `${totalItems} item`;
  if (elTotQty) elTotQty.textContent = `${formatNumber(totalQty)} pcs`;
}

function resetLogisticsForm() {
  const form = document.getElementById('fakturForm');
  if (form) form.reset();

  // Reset STB photo
  AppState.logisticsForm.stbPhoto = null;
  const stbEmpty = document.getElementById('stbEmptyState');
  const stbPrev = document.getElementById('stbPreviewContainer');
  if (stbEmpty) stbEmpty.style.display = 'block';
  if (stbPrev) stbPrev.style.display = 'none';

  // Reset Other photos
  AppState.logisticsForm.otherDocsPhotos = [];
  const otherGallery = document.getElementById('otherDocsGallery');
  if (otherGallery) otherGallery.innerHTML = '';

  // Reset Dynamic Rows
  const tbody = document.getElementById('itemsInputTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    addFormItemRow(); // start with 1 blank row
  }

  // Set today's date in inputTglDiterima
  const dateInput = document.getElementById('inputTglDiterima');
  if (dateInput) {
    const today = new Date();
    dateInput.value = today.toISOString().split('T')[0];
  }

  // Set active operator name & role
  const opInput = document.getElementById('inputOperatorName');
  if (opInput) {
    opInput.value = `${AppState.currentUser.name} (${AppState.currentUser.role.toUpperCase()})`;
  }

  updateFormSummary();
}

async function handleFakturFormSubmit(e) {
  e.preventDefault();

  const noPo = document.getElementById('inputNoPo').value.trim();
  const noDo = document.getElementById('inputNoDo').value.trim();
  const tglDiterima = document.getElementById('inputTglDiterima').value;
  const pengirim = document.getElementById('inputPengirim').value.trim();
  const nopol = document.getElementById('inputNopol').value.trim();
  const namaSopir = document.getElementById('inputNamaSopir').value.trim();
  const kontakSopir = document.getElementById('inputKontakSopir').value.trim();

  // Validate items
  const tbody = document.getElementById('itemsInputTableBody');
  const rows = tbody.querySelectorAll('.dynamic-item-row');
  const items = [];

  rows.forEach(r => {
    const name = r.querySelector('.input-item-name').value.trim();
    const qty = parseInt(r.querySelector('.input-item-qty').value, 10) || 0;
    const exp = r.querySelector('.input-item-exp').value;
    if (name && qty > 0) {
      items.push({
        nama_barang: name,
        qty_diterima: qty,
        tgl_expired: exp
      });
    }
  });

  if (items.length === 0) {
    showToast('Validasi Gagal', 'Harap isi minimal 1 rincian barang beserta kuantitasnya.', 'warning');
    return;
  }

  // Validate STB Photo
  if (!AppState.logisticsForm.stbPhoto) {
    showToast('Foto STB Wajib', 'Harap unggah bukti foto STB (Surat Terima Barang).', 'warning');
    return;
  }

  const submitBtn = document.getElementById('btnSubmitFaktur');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan Faktur & Mengunggah...';
  }

  const generatedId = `FK-${formatDateStandard(new Date()).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  const payload = {
    action: 'createFaktur',
    header: {
      id_faktur: generatedId,
      timestamp: new Date().toISOString(),
      no_po: noPo,
      no_do: noDo,
      tgl_diterima: tglDiterima,
      pengirim: pengirim,
      nopol_pengirim: nopol,
      nama_sopir: namaSopir,
      kontak_sopir: kontakSopir,
      dibuat_oleh: `${AppState.currentUser.name} (${AppState.currentUser.role.toUpperCase()})`,
      drive_folder_url: AppState.config.driveFolderUrl || DEFAULT_CONFIG.DRIVE_FOLDER_URL,
      faktur_spreadsheet_url: (AppState.config.databaseOverrides && AppState.config.databaseOverrides.faktur_logistik) || 
        (AppState.databasesCatalog.find(c => c.key_database === 'faktur_logistik')?.link_spreadsheet) || '',
      stb_photo_base64: AppState.logisticsForm.stbPhoto.base64,
      stb_filename: AppState.logisticsForm.stbPhoto.name,
      other_photos: AppState.logisticsForm.otherDocsPhotos.map(p => ({
        name: p.name,
        base64: p.base64
      })),
      total_jenis_barang: items.length,
      total_qty_diterima: items.reduce((s, it) => s + it.qty_diterima, 0)
    },
    items: items
  };

  try {
    let cloudResult = null;
    if (AppState.config.scriptUrl) {
      // Send to Google Apps Script Backend
      const res = await fetch(AppState.config.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        cloudResult = await res.json();
      }
    }

    // Save locally to IndexedDB as well
    const newInvoiceRecord = {
      ...payload.header,
      url_foto_stb: (cloudResult && cloudResult.url_foto_stb) ? cloudResult.url_foto_stb : AppState.logisticsForm.stbPhoto.base64,
      url_foto_dokumen_lain: (cloudResult && cloudResult.url_foto_dokumen_lain) ? cloudResult.url_foto_dokumen_lain : AppState.logisticsForm.otherDocsPhotos.map(p => p.base64),
      items: items
    };

    AppState.invoices.unshift(newInvoiceRecord);
    await DB.set('invoices', newInvoiceRecord);

    showToast('Faktur Tersimpan!', `Faktur ${generatedId} berhasil disimpan ke sistem dan Google Drive.`, 'success');
    resetLogisticsForm();

    // Switch to history tab
    document.getElementById('subtab-btn-history').click();
    renderLogisticsSection();
    renderSidebarStats();

  } catch (err) {
    console.error('Faktur submission error:', err);
    // Offline fallback save
    const fallbackRecord = {
      ...payload.header,
      url_foto_stb: AppState.logisticsForm.stbPhoto.base64,
      url_foto_dokumen_lain: AppState.logisticsForm.otherDocsPhotos.map(p => p.base64),
      items: items
    };

    AppState.invoices.unshift(fallbackRecord);
    await DB.set('invoices', fallbackRecord);

    showToast('Tersimpan Lokal', 'Gagal tersambung ke Google Apps Script, faktur berhasil disimpan di cache IndexedDB lokal Anda.', 'warning', 5000);
    resetLogisticsForm();
    document.getElementById('subtab-btn-history').click();
    renderLogisticsSection();

  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Simpan & Kirim Penerimaan Barang';
    }
  }
}

/* ============================================================================
   SETTINGS MODAL & DEMO DATA GENERATOR
   ============================================================================ */

function renderDetectedDatabases(catalog) {
  const container = document.getElementById('detectedDbList');
  const badge = document.getElementById('detectedCountBadge');
  if (!container) return;

  if (badge) badge.textContent = `${catalog.length} Terdeteksi`;

  if (catalog.length === 0) {
    container.innerHTML = `<div class="empty-detected">Belum ada database dimuat. Klik "Sinkronkan Semua Database" di bawah.</div>`;
    return;
  }

  container.innerHTML = catalog.map(item => `
    <div class="detected-db-item">
      <div>
        <span class="db-item-key">${escapeHtml(item.key_database)}</span>
        <span class="db-item-name"> — ${escapeHtml(item.nama_database)}</span>
      </div>
      <a href="${item.link_spreadsheet}" target="_blank" rel="noopener" class="badge badge-accent" style="text-decoration:none;">
        <i class="fa-solid fa-arrow-up-right-from-square"></i> Buka Link
      </a>
    </div>
  `).join('');
}

function renderDatabaseStatusTab() {
  const elSource = document.getElementById('statusDataSource');
  const elLast = document.getElementById('statusLastSync');
  const elProd = document.getElementById('statusTotalProducts');
  const elOp = document.getElementById('statusTotalOpnames');
  const elInv = document.getElementById('statusTotalInvoices');

  if (elSource) elSource.textContent = AppState.config.coreAppUrl ? 'Core App Spreadsheet' : 'IndexedDB (Lokal)';
  if (elLast) elLast.textContent = AppState.config.lastSync ? formatDateDisplay(AppState.config.lastSync) + ' ' + new Date(AppState.config.lastSync).toLocaleTimeString() : 'Belum pernah';
  if (elProd) elProd.textContent = `${AppState.products.length} Item`;
  if (elOp) elOp.textContent = `${AppState.stockDates.length} Tanggal Opname`;
  if (elInv) elInv.textContent = `${AppState.invoices.length} Faktur`;
}

/**
 * Loads rich demo data with realistic FMCG / retail products & dates
 */
async function loadDemoData() {
  showToast('Memuat Data Demo...', 'Menyiapkan sampel produk, stok opname, dan faktur logistik...', 'info', 2000);

  // 1. Demo Price List
  const demoPrices = new Map([
    ['Indomie Goreng Spesial 85g', { producer: 'PT Indofood Sukses Makmur', price: 3100 }],
    ['Indomie Ayam Bawang 69g', { producer: 'PT Indofood Sukses Makmur', price: 3000 }],
    ['Pop Mie Rasa Ayam 75g', { producer: 'PT Indofood Sukses Makmur', price: 5500 }],
    ['Aqua Air Mineral Botol 600ml', { producer: 'PT Danone Aqua', price: 3500 }],
    ['Aqua Galon 19L', { producer: 'PT Danone Aqua', price: 21000 }],
    ['Mizone Lychee Lemon 500ml', { producer: 'PT Danone Aqua', price: 5000 }],
    ['Minyak Goreng Bimoli Klasik 2L', { producer: 'PT Salim Ivomas Pratama', price: 36500 }],
    ['Sabun Cuci Daia Putih 850g', { producer: 'PT Wings Surya', price: 17500 }],
    ['Mie Sedaap Goreng 90g', { producer: 'PT Wings Surya', price: 3100 }],
    ['Kecap Manis Sedaap 550ml', { producer: 'PT Wings Surya', price: 18000 }],
    ['Sabun Lifebuoy Total 10 110g', { producer: 'PT Unilever Indonesia', price: 4800 }],
    ['Shampoo Sunsilk Black Shine 160ml', { producer: 'PT Unilever Indonesia', price: 24500 }],
    ['Kopi Kapal Api Spesial Mix 10x24g', { producer: 'PT Santos Jaya Abadi', price: 14500 }],
    ['Susu Ultra Milk Cokelat 250ml', { producer: 'PT Ultrajaya Milk Industry', price: 6500 }],
    ['Biskuit Roma Kelapa 300g', { producer: 'PT Mayora Indah', price: 12000 }],
    ['Torabika Cappuccino 10x25g', { producer: 'PT Mayora Indah', price: 16500 }],
    ['Beras Ramos Super Premium 5kg', { producer: 'Bulog / Kemitraan', price: 72000 }]
  ]);

  AppState.priceList = demoPrices;

  // 2. Demo Stock Opname across 4 weekly dates
  const dates = ['07-10-2024', '14-10-2024', '21-10-2024', '28-10-2024'];
  const stockRecords = [];

  const baseStocks = {
    'Indomie Goreng Spesial 85g': [140, 110, 85, 45],
    'Indomie Ayam Bawang 69g': [95, 75, 55, 30],
    'Pop Mie Rasa Ayam 75g': [60, 48, 35, 18],
    'Aqua Air Mineral Botol 600ml': [220, 160, 110, 65],
    'Aqua Galon 19L': [50, 32, 45, 20],
    'Mizone Lychee Lemon 500ml': [40, 30, 22, 12],
    'Minyak Goreng Bimoli Klasik 2L': [80, 62, 40, 22],
    'Sabun Cuci Daia Putih 850g': [70, 52, 38, 24],
    'Mie Sedaap Goreng 90g': [120, 95, 70, 40],
    'Kecap Manis Sedaap 550ml': [45, 36, 25, 15],
    'Sabun Lifebuoy Total 10 110g': [90, 72, 50, 4], // alert <= 5 pcs
    'Shampoo Sunsilk Black Shine 160ml': [35, 28, 20, 14],
    'Kopi Kapal Api Spesial Mix 10x24g': [110, 82, 58, 32],
    'Susu Ultra Milk Cokelat 250ml': [130, 95, 65, 35],
    'Biskuit Roma Kelapa 300g': [65, 48, 32, 3], // alert <= 5 pcs
    'Torabika Cappuccino 10x25g': [75, 58, 42, 25],
    'Beras Ramos Super Premium 5kg': [40, 30, 18, 5] // alert <= 5 pcs
  };

  dates.forEach((dt, dateIdx) => {
    for (const [prodName, stockSeq] of Object.entries(baseStocks)) {
      const tot = stockSeq[dateIdx];
      const toko = Math.round(tot * 0.4);
      const gudang = tot - toko;

      stockRecords.push({
        tgl_opname: dt,
        nama_produk: prodName,
        stok_toko: toko,
        stok_gudang: gudang,
        total_stok: tot
      });
    }
  });

  AppState.stockRecords = stockRecords;
  AppState.stockDates = dates;
  AppState.selectedStockDate = dates[dates.length - 1];

  // 3. Compute Sales
  const { sales } = computeSalesFromStock(AppState.stockRecords, AppState.priceList);
  AppState.salesRecords = sales;

  // 4. Consolidate Products
  AppState.products = consolidateProducts(AppState.priceList, AppState.stockRecords, AppState.salesRecords, dates);

  // 5. Demo Logistics Invoices with sample SVG Doc thumbnails
  const dummySvgStb = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%231e293b'/%3E%3Crect x='20' y='20' width='360' height='260' fill='%230f172a' stroke='%2338bdf8' stroke-width='2' rx='8'/%3E%3Ctext x='40' y='65' fill='%2338bdf8' font-family='sans-serif' font-size='18' font-weight='bold'%3EBukti STB - Surat Terima Barang%3C/text%3E%3Ctext x='40' y='105' fill='%2394a3b8' font-family='sans-serif' font-size='13'%3EKDKMP PARANG LOGISTICS%3C/text%3E%3Cline x1='40' y1='120' x2='360' y2='120' stroke='%23334155' stroke-width='1.5'/%3E%3Ctext x='40' y='155' fill='%23e2e8f0' font-family='sans-serif' font-size='13'%3ETerima dari: PT Indofood Sukses Makmur%3C/text%3E%3Ctext x='40' y='185' fill='%23e2e8f0' font-family='sans-serif' font-size='13'%3EStatus: LENGKAP &amp; DIVERIFIKASI%3C/text%3E%3Crect x='40' y='215' width='120' height='30' fill='%2310b981' rx='4'/%3E%3Ctext x='62' y='235' fill='%23ffffff' font-family='sans-serif' font-size='12' font-weight='bold'%3ETERTANDA%3C/text%3E%3C/svg%3E";

  const dummySvgDo = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%231e293b'/%3E%3Crect x='20' y='20' width='360' height='260' fill='%230f172a' stroke='%23a855f7' stroke-width='2' rx='8'/%3E%3Ctext x='40' y='65' fill='%23a855f7' font-family='sans-serif' font-size='18' font-weight='bold'%3EDelivery Order / Surat Jalan%3C/text%3E%3Ctext x='40' y='105' fill='%2394a3b8' font-family='sans-serif' font-size='13'%3EEkspedisi Angkutan Logistik%3C/text%3E%3Cline x1='40' y1='120' x2='360' y2='120' stroke='%23334155' stroke-width='1.5'/%3E%3Ctext x='40' y='155' fill='%23e2e8f0' font-family='sans-serif' font-size='13'%3ENopol: AD 8912 UQ%3C/text%3E%3Ctext x='40' y='185' fill='%23e2e8f0' font-family='sans-serif' font-size='13'%3EBarang diterima baik tanpa cacat%3C/text%3E%3C/svg%3E";

  // Calculate realistic near-future expiry dates
  const today = new Date();
  const datePlusDays = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  AppState.invoices = [
    {
      id_faktur: 'FK-202410-8910',
      timestamp: new Date().toISOString(),
      no_po: 'PO-KDKMP/2024/10/012',
      no_do: 'DO-INDOFOOD/98213',
      tgl_diterima: '2024-10-24',
      pengirim: 'PT Indofood Sukses Makmur',
      nopol_pengirim: 'AD 8492 EP',
      nama_sopir: 'Bpk. Supardi',
      kontak_sopir: '081329482910',
      url_foto_stb: dummySvgStb,
      url_foto_dokumen_lain: [dummySvgDo],
      total_jenis_barang: 3,
      total_qty_diterima: 300,
      items: [
        { nama_barang: 'Indomie Goreng Spesial 85g', qty_diterima: 150, tgl_expired: datePlusDays(180) }, // safe
        { nama_barang: 'Indomie Ayam Bawang 69g', qty_diterima: 100, tgl_expired: datePlusDays(14) },  // CRITICAL <= 30 days!
        { nama_barang: 'Pop Mie Rasa Ayam 75g', qty_diterima: 50, tgl_expired: datePlusDays(90) }
      ]
    },
    {
      id_faktur: 'FK-202410-6721',
      timestamp: new Date().toISOString(),
      no_po: 'PO-KDKMP/2024/10/009',
      no_do: 'DO-DANONE/44120',
      tgl_diterima: '2024-10-20',
      pengirim: 'PT Danone Aqua',
      nopol_pengirim: 'B 9204 UDF',
      nama_sopir: 'Bpk. Bambang Sutrisno',
      kontak_sopir: '082199482012',
      url_foto_stb: dummySvgStb,
      url_foto_dokumen_lain: [],
      total_jenis_barang: 2,
      total_qty_diterima: 180,
      items: [
        { nama_barang: 'Aqua Air Mineral Botol 600ml', qty_diterima: 120, tgl_expired: datePlusDays(360) },
        { nama_barang: 'Aqua Galon 19L', qty_diterima: 60, tgl_expired: datePlusDays(300) }
      ]
    },
    {
      id_faktur: 'FK-202410-3319',
      timestamp: new Date().toISOString(),
      no_po: 'PO-KDKMP/2024/10/004',
      no_do: 'DO-WINGS/78104',
      tgl_diterima: '2024-10-15',
      pengirim: 'PT Wings Surya',
      nopol_pengirim: 'L 8109 AA',
      nama_sopir: 'Bpk. Joko Santoso',
      kontak_sopir: '085712398471',
      url_foto_stb: dummySvgStb,
      url_foto_dokumen_lain: [dummySvgDo],
      total_jenis_barang: 2,
      total_qty_diterima: 160,
      items: [
        { nama_barang: 'Sabun Cuci Daia Putih 850g', qty_diterima: 80, tgl_expired: datePlusDays(450) },
        { nama_barang: 'Mie Sedaap Goreng 90g', qty_diterima: 80, tgl_expired: datePlusDays(-5) } // EXPIRED!
      ]
    }
  ];

  // 6. Demo Core App Catalog
  AppState.databasesCatalog = [
    { key_database: 'stock_opname', nama_database: 'Database Stok Opname Toko & Gudang', link_spreadsheet: 'https://docs.google.com/spreadsheets/d/demo_stock_opname/edit', keterangan: 'Format sheet tanggal per minggu' },
    { key_database: 'daftar_harga', nama_database: 'Database Master Daftar Harga', link_spreadsheet: 'https://docs.google.com/spreadsheets/d/demo_daftar_harga/edit', keterangan: 'Master harga dan produsen' },
    { key_database: 'faktur_logistik', nama_database: 'Database Faktur & Penerimaan Logistik', link_spreadsheet: 'https://docs.google.com/spreadsheets/d/demo_faktur_logistik/edit', keterangan: 'Sheet Faktur_Header & Faktur_Detail' }
  ];

  // Persist all demo data to IndexedDB
  await DB.clear('stock_history');
  await DB.bulkPut('stock_history', AppState.stockRecords);

  await DB.clear('sales_records');
  await DB.bulkPut('sales_records', AppState.salesRecords);

  await DB.clear('products');
  await DB.bulkPut('products', AppState.products);

  await DB.clear('invoices');
  await DB.bulkPut('invoices', AppState.invoices);

  await DB.bulkPut('databases_catalog', AppState.databasesCatalog);

  AppState.config.lastSync = new Date().toISOString();
  await DB.set('config', { key: 'mainConfig', ...AppState.config });

  renderDetectedDatabases(AppState.databasesCatalog);
  renderAllViews();
  showToast('Data Demo Siap!', 'Dashboard kini terisi data realistis lengkap dengan grafik, stok, dan faktur logistik.', 'success', 5000);
}

/* ============================================================================
   USER AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
   ============================================================================ */

/* ============================================================================
   USER AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
   ============================================================================ */

function applyUserPermissions() {
  if (!AppState.currentUser) return;
  const user = AppState.currentUser;
  const isAsmen = user.role === 'asmen';

  // Toggle body class for CSS role hiding
  document.body.classList.toggle('role-asmen', isAsmen);

  // Update Top Header profile widget
  const headerName = document.getElementById('headerUserName');
  const headerBadge = document.getElementById('headerUserRoleBadge');
  const headerAvatar = document.getElementById('headerUserAvatar');

  if (headerName) headerName.textContent = user.name;
  if (headerBadge) {
    headerBadge.textContent = user.roleLabel;
    headerBadge.className = isAsmen ? 'badge badge-accent user-role-pill' : 'badge badge-purple user-role-pill';
  }
  if (headerAvatar) {
    headerAvatar.className = isAsmen ? 'user-avatar role-asmen-avatar' : 'user-avatar';
    headerAvatar.innerHTML = isAsmen ? '<i class="fa-solid fa-user-gear"></i>' : '<i class="fa-solid fa-user-shield"></i>';
  }

  // Update factur form operator input field
  const opInput = document.getElementById('inputOperatorName');
  if (opInput) opInput.value = `${user.name} (${user.roleLabel})`;

  // If Asmen is currently on a restricted page, immediately redirect to 'stock'
  if (isAsmen && AppState.activeSection !== 'stock' && AppState.activeSection !== 'logistics') {
    switchSection('stock');
  }
}

const AuthManager = {
  init() {
    // Check if logout was requested via URL param (e.g. ?logout=1)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('logout') === '1') {
      localStorage.removeItem('kdkmp_current_user');
      sessionStorage.removeItem('kdkmp_current_user');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const saved = localStorage.getItem('kdkmp_current_user') || sessionStorage.getItem('kdkmp_current_user');
    const matchedUser = Object.values(USERS_DB).find(u => u.username.toLowerCase() === (saved || '').toLowerCase() || u.role === saved);
    if (saved && matchedUser) {
      AppState.currentUser = matchedUser;
      this.hideLoginScreen();
      applyUserPermissions();
      if (AppState.currentUser.role === 'asmen' && AppState.activeSection !== 'stock' && AppState.activeSection !== 'logistics') {
        switchSection('stock');
      }
    } else {
      AppState.currentUser = null;
      this.showLoginScreen();
    }
  },

  showLoginScreen() {
    const app = document.getElementById('app');
    const screen = document.getElementById('loginScreen');
    if (app) app.style.display = 'none';
    if (screen) {
      screen.style.display = 'flex';
      const pwd = document.getElementById('loginPasswordInput');
      if (pwd) pwd.value = '';
      const alert = document.getElementById('loginErrorAlert');
      if (alert) alert.style.display = 'none';
      const userInp = document.getElementById('loginUsernameInput');
      if (userInp) {
        userInp.value = '';
        setTimeout(() => userInp.focus(), 150);
      }
    }
  },

  hideLoginScreen() {
    const app = document.getElementById('app');
    const screen = document.getElementById('loginScreen');
    if (screen) screen.style.display = 'none';
    if (app) app.style.display = 'flex';
  },

  login(username, password, remember = true) {
    username = String(username || '').trim().toLowerCase();
    const user = Object.values(USERS_DB).find(u => u.username.toLowerCase() === username);
    const alertBox = document.getElementById('loginErrorAlert');
    const alertMsg = document.getElementById('loginErrorMessage');

    if (!user || user.password !== password) {
      if (alertBox && alertMsg) {
        alertMsg.textContent = 'Username atau kata sandi tidak sesuai. Silakan periksa kembali.';
        alertBox.style.display = 'flex';
      }
      return false;
    }

    if (alertBox) alertBox.style.display = 'none';

    // Store session
    if (remember) {
      localStorage.setItem('kdkmp_current_user', username);
      sessionStorage.removeItem('kdkmp_current_user');
    } else {
      sessionStorage.setItem('kdkmp_current_user', username);
      localStorage.removeItem('kdkmp_current_user');
    }

    AppState.currentUser = user;
    this.hideLoginScreen();
    applyUserPermissions();

    if (user.role === 'asmen') {
      switchSection('stock');
    } else {
      switchSection('overview');
    }

    showToast('Masuk Berhasil', `Selamat datang, ${user.name}! Anda aktif sebagai ${user.roleLabel}.`, 'success');
    return true;
  },

  logout() {
    localStorage.removeItem('kdkmp_current_user');
    sessionStorage.removeItem('kdkmp_current_user');
    AppState.currentUser = null;
    document.body.classList.remove('role-asmen');
    this.showLoginScreen();
    showToast('Sesi Berakhir', 'Anda telah keluar dari sistem dashboard.', 'info');
  }
};

/* ============================================================================
   EVENT HANDLERS & NAVIGATION CONTROLLER
   ============================================================================ */

function setupNavigation() {
  // Desktop sidebar nav links
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      switchSection(target);
    });
  });

  // Mobile bottom nav links
  document.querySelectorAll('.bottom-nav .bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      switchSection(target);
    });
  });

  // Real Login Form Submit
  const realLoginForm = document.getElementById('realLoginForm');
  if (realLoginForm) {
    realLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const u = document.getElementById('loginUsernameInput').value;
      const p = document.getElementById('loginPasswordInput').value;
      const rem = document.getElementById('rememberMeCheck')?.checked;
      AuthManager.login(u, p, rem);
    });
  }

  // Toggle Password Visibility
  const btnTogglePassword = document.getElementById('btnTogglePassword');
  const loginPasswordInput = document.getElementById('loginPasswordInput');
  const togglePasswordIcon = document.getElementById('togglePasswordIcon');
  if (btnTogglePassword && loginPasswordInput && togglePasswordIcon) {
    btnTogglePassword.addEventListener('click', () => {
      const isPassword = loginPasswordInput.type === 'password';
      loginPasswordInput.type = isPassword ? 'text' : 'password';
      togglePasswordIcon.className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    });
  }

  // User Logout Button in Header
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      AuthManager.logout();
    });
  }

  // Sidebar collapse toggle
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  const sidebar = document.getElementById('sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }

  // Mobile drawer hamburger & overlay
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const overlay = document.getElementById('drawerOverlay');
  if (mobileMenuBtn && sidebar && overlay) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('active');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }

  // Period Segmented Control Filter
  document.querySelectorAll('.segmented-control .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.segmented-control .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.activePeriod = btn.getAttribute('data-period');
      renderOverviewSection();
    });
  });

  // Settings Modal Open/Close (Khusus Akun Admin)
  const settingsModal = document.getElementById('settingsModal');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');

  const populateSettingsFields = () => {
    const elDrive = document.getElementById('inputDriveFolderUrl');
    const elCore = document.getElementById('inputCoreAppUrl');
    const elScript = document.getElementById('inputScriptUrl');
    const elStock = document.getElementById('inputDbStockUrl');
    const elPrice = document.getElementById('inputDbPriceUrl');
    const elLog = document.getElementById('inputDbLogisticsUrl');

    if (elDrive) elDrive.value = AppState.config.driveFolderUrl || DEFAULT_CONFIG.DRIVE_FOLDER_URL;
    if (elCore) elCore.value = AppState.config.coreAppUrl || DEFAULT_CONFIG.CORE_APP_URL;
    if (elScript) elScript.value = AppState.config.scriptUrl || DEFAULT_CONFIG.SCRIPT_URL;

    const ov = AppState.config.databaseOverrides || {};
    if (elStock) elStock.value = ov.stock_opname || '';
    if (elPrice) elPrice.value = ov.daftar_harga || '';
    if (elLog) elLog.value = ov.faktur_logistik || '';
  };

  const openSettings = () => {
    if (AppState.currentUser.role === 'asmen') {
      showToast('Akses Dibatasi', 'Hanya Administrator yang memiliki wewenang untuk membuka Pengaturan Database.', 'warning');
      return;
    }
    populateSettingsFields();
    if (settingsModal) settingsModal.classList.add('active');
  };
  const closeSettings = () => {
    if (settingsModal) settingsModal.classList.remove('active');
  };

  if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettings);
  if (closeSettingsModalBtn) closeSettingsModalBtn.addEventListener('click', closeSettings);

  // Reset Sub-Database Links to Core App Default
  const btnResetToDefaultLinks = document.getElementById('btnResetToDefaultLinks');
  if (btnResetToDefaultLinks) {
    btnResetToDefaultLinks.addEventListener('click', () => {
      const elStock = document.getElementById('inputDbStockUrl');
      const elPrice = document.getElementById('inputDbPriceUrl');
      const elLog = document.getElementById('inputDbLogisticsUrl');
      if (elStock) elStock.value = '';
      if (elPrice) elPrice.value = '';
      if (elLog) elLog.value = '';
      showToast('Reset Link', 'Link dikembalikan ke mode otomatis mengikuti Core App.', 'info');
    });
  }

  // Settings Modal Tabs
  document.querySelectorAll('.modal-tabs .modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tabs .modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const targetContent = document.getElementById(tab.getAttribute('data-modaltab'));
      if (targetContent) targetContent.classList.add('active');
    });
  });

  // Invoice Detail Modal Close
  const closeDetailModalBtn = document.getElementById('closeDetailModalBtn');
  const detailModal = document.getElementById('invoiceDetailModal');
  if (closeDetailModalBtn && detailModal) {
    closeDetailModalBtn.addEventListener('click', () => {
      detailModal.classList.remove('active');
    });
  }

  // Lightbox Close
  const lightboxModal = document.getElementById('lightboxModal');
  const lightboxCloseBtn = document.getElementById('lightboxCloseBtn');
  if (lightboxModal && lightboxCloseBtn) {
    lightboxCloseBtn.addEventListener('click', () => lightboxModal.classList.remove('active'));
    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) lightboxModal.classList.remove('active');
    });
  }

  // Quick Sync buttons
  const quickSyncBtn = document.getElementById('quickSyncBtn');
  if (quickSyncBtn) {
    quickSyncBtn.addEventListener('click', () => {
      syncAllDatabases(AppState.config.coreAppUrl, AppState.config.scriptUrl);
    });
  }

  // Demo Button in Modal Status
  const btnLoadDemoInModal = document.getElementById('btnLoadDemoInModal');
  if (btnLoadDemoInModal) {
    btnLoadDemoInModal.addEventListener('click', () => {
      loadDemoData();
      closeSettings();
    });
  }

  // Reset Database Button
  const btnResetDatabase = document.getElementById('btnResetDatabase');
  if (btnResetDatabase) {
    btnResetDatabase.addEventListener('click', async () => {
      if (confirm('Apakah Anda yakin ingin mengosongkan seluruh database lokal di IndexedDB?')) {
        await DB.resetAll();
        AppState.products = [];
        AppState.stockRecords = [];
        AppState.salesRecords = [];
        AppState.invoices = [];
        AppState.stockDates = [];
        AppState.databasesCatalog = [];
        AppState.config.lastSync = null;
        renderAllViews();
        showToast('Database Dikosongkan', 'Seluruh data lokal telah direset.', 'info');
      }
    });
  }

  // Save Config Button (Menyimpan Link Core App, Script, Drive Folder, dan Override Sub-DB)
  const btnSaveConfig = document.getElementById('btnSaveConfig');
  if (btnSaveConfig) {
    btnSaveConfig.addEventListener('click', async () => {
      const driveUrl = document.getElementById('inputDriveFolderUrl').value.trim();
      const coreUrl = document.getElementById('inputCoreAppUrl').value.trim();
      const scriptUrl = document.getElementById('inputScriptUrl').value.trim();
      const stockUrl = document.getElementById('inputDbStockUrl').value.trim();
      const priceUrl = document.getElementById('inputDbPriceUrl').value.trim();
      const logUrl = document.getElementById('inputDbLogisticsUrl').value.trim();

      AppState.config.driveFolderUrl = driveUrl || DEFAULT_CONFIG.DRIVE_FOLDER_URL;
      AppState.config.coreAppUrl = coreUrl || DEFAULT_CONFIG.CORE_APP_URL;
      AppState.config.scriptUrl = scriptUrl || DEFAULT_CONFIG.SCRIPT_URL;
      
      AppState.config.databaseOverrides = {
        stock_opname: stockUrl,
        daftar_harga: priceUrl,
        faktur_logistik: logUrl
      };

      await DB.set('config', { key: 'mainConfig', ...AppState.config });
      showToast('Tersimpan', 'Pengaturan folder Google Drive & link database berhasil disimpan.', 'success');
    });
  }

  // Sync All Button in Modal
  const btnSyncAll = document.getElementById('btnSyncAll');
  if (btnSyncAll) {
    btnSyncAll.addEventListener('click', () => {
      const coreUrl = document.getElementById('inputCoreAppUrl').value.trim() || AppState.config.coreAppUrl;
      const scriptUrl = document.getElementById('inputScriptUrl').value.trim() || AppState.config.scriptUrl;
      syncAllDatabases(coreUrl, scriptUrl);
    });
  }

  // Export DB Backup JSON
  const btnExportDbBackup = document.getElementById('btnExportDbBackup');
  if (btnExportDbBackup) {
    btnExportDbBackup.addEventListener('click', () => {
      const backupData = {
        exportedAt: new Date().toISOString(),
        config: AppState.config,
        databasesCatalog: AppState.databasesCatalog,
        products: AppState.products,
        stockRecords: AppState.stockRecords,
        salesRecords: AppState.salesRecords,
        invoices: AppState.invoices
      };
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `KDKMP_Backup_${formatDateStandard(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

function switchSection(targetSection) {
  // Enforce Asmen restriction: Asmen can only access 'stock' and 'logistics'
  if (AppState.currentUser.role === 'asmen' && targetSection !== 'stock' && targetSection !== 'logistics') {
    targetSection = 'stock';
    showToast('Akses Dibatasi', 'Akun Asisten Manajer (Asmen) hanya dapat mengakses menu Stok Opname dan Faktur Logistik.', 'warning', 4000);
  }

  AppState.activeSection = targetSection;

  // Update Section visibility
  document.querySelectorAll('.spa-section').forEach(sec => sec.classList.remove('active'));
  const targetEl = document.getElementById(`section-${targetSection}`);
  if (targetEl) targetEl.classList.add('active');

  // Update Nav links
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-target') === targetSection);
  });
  document.querySelectorAll('.bottom-nav .bottom-nav-item').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-target') === targetSection);
  });

  // Close mobile drawer if open
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('drawerOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');

  // Update Top Header Titles
  const titleMap = {
    overview: { title: 'Ringkasan Penjualan', sub: 'Metrik performa penjualan dan pergerakan stok barang' },
    products: { title: 'Daftar Produk', sub: 'Katalog barang lengkap dengan harga, kuantitas terjual, dan status stok' },
    producers: { title: 'Analisis Produsen', sub: 'Perbandingan pangsa omset dan volume distribusi tiap supplier' },
    stock: { title: 'Stok Opname', sub: 'Laporan inventori toko groceries dan gudang warehouse' },
    logistics: { title: 'Faktur & Logistik', sub: 'Penerimaan barang masuk, monitoring expired, dan bukti foto ekspedisi' }
  };

  const meta = titleMap[targetSection] || { title: 'Dashboard', sub: '' };
  const elTitle = document.getElementById('currentPageTitle');
  const elSub = document.getElementById('currentPageSubtitle');
  if (elTitle) elTitle.textContent = meta.title;
  if (elSub) elSub.textContent = meta.sub;

  // Trigger re-render of active view
  if (targetSection === 'overview') renderOverviewSection();
  if (targetSection === 'products') renderProductsSection();
  if (targetSection === 'producers') renderProducersSection();
  if (targetSection === 'stock') renderStockSection();
  if (targetSection === 'logistics') renderLogisticsSection();
}

/**
 * Setup Event Listeners for Tables, Filters, and Forms
 */
function setupInteractions() {
  // Products search, filter, and sort
  const prodSearch = document.getElementById('productSearchInput');
  const prodFilter = document.getElementById('productProducerFilter');
  const prodSort = document.getElementById('productSortBy');

  if (prodSearch) {
    prodSearch.addEventListener('input', (e) => {
      AppState.productsTablePagination.search = e.target.value;
      AppState.productsTablePagination.page = 1;
      renderProductsSection();
    });
  }

  if (prodFilter) {
    prodFilter.addEventListener('change', (e) => {
      AppState.productsTablePagination.producer = e.target.value;
      AppState.productsTablePagination.page = 1;
      renderProductsSection();
    });
  }

  if (prodSort) {
    prodSort.addEventListener('change', (e) => {
      AppState.productsTablePagination.sortBy = e.target.value;
      AppState.productsTablePagination.page = 1;
      renderProductsSection();
    });
  }

  // Export Products CSV
  const exportProductsCsvBtn = document.getElementById('exportProductsCsvBtn');
  if (exportProductsCsvBtn) {
    exportProductsCsvBtn.addEventListener('click', () => {
      let csv = 'Nama Produk,Produsen,Harga Satuan,Qty Terjual,Total Pendapatan,Stok Terakhir\n';
      AppState.products.forEach(p => {
        csv += `"${p.nama_produk.replace(/"/g, '""')}","${p.produsen.replace(/"/g, '""')}",${p.harga},${p.qty_terjual},${p.total_pendapatan},${p.stok_terakhir}\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `KDKMP_Produk_${formatDateStandard(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Stock Opname date picker & search
  const stockDateSelect = document.getElementById('stockDateSelect');
  const stockSearchInput = document.getElementById('stockSearchInput');
  if (stockDateSelect) {
    stockDateSelect.addEventListener('change', (e) => {
      AppState.selectedStockDate = e.target.value;
      renderStockSection();
    });
  }
  if (stockSearchInput) {
    stockSearchInput.addEventListener('input', () => renderStockSection());
  }

  // Export Stock Opname
  const exportStockBtn = document.getElementById('exportStockBtn');
  if (exportStockBtn) {
    exportStockBtn.addEventListener('click', () => {
      const activeDate = AppState.selectedStockDate;
      const currentStocks = AppState.stockRecords.filter(r => r.tgl_opname === activeDate);
      let csv = 'No,Nama Produk,Stok Toko,Stok Gudang,Total Stok,Harga Satuan,Nilai Inventori\n';
      currentStocks.forEach((r, i) => {
        const pr = AppState.priceList.get(r.nama_produk);
        const price = pr ? pr.price : 0;
        csv += `${i + 1},"${r.nama_produk.replace(/"/g, '""')}",${r.stok_toko},${r.stok_gudang},${r.total_stok},${price},${r.total_stok * price}\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `KDKMP_Stok_${activeDate || 'Semua'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Logistics Sub-Tabs
  const subtabHistoryBtn = document.getElementById('subtab-btn-history');
  const subtabFormBtn = document.getElementById('subtab-btn-form');
  const btnSwitchToNewForm = document.getElementById('btnSwitchToNewForm');
  const btnCancelFormTop = document.getElementById('btnCancelFormTop');
  const btnCancelForm = document.getElementById('btnCancelForm');

  const showSubtab = (tabId) => {
    document.querySelectorAll('.subnav-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.subtab-view').forEach(v => v.classList.remove('active'));

    const tabBtn = document.getElementById(tabId === 'logistics-history' ? 'subtab-btn-history' : 'subtab-btn-form');
    const viewEl = document.getElementById(`subtab-${tabId}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (viewEl) viewEl.classList.add('active');
  };

  if (subtabHistoryBtn) subtabHistoryBtn.addEventListener('click', () => showSubtab('logistics-history'));
  if (subtabFormBtn) subtabFormBtn.addEventListener('click', () => showSubtab('logistics-form'));
  if (btnSwitchToNewForm) btnSwitchToNewForm.addEventListener('click', () => showSubtab('logistics-form'));
  if (btnCancelFormTop) btnCancelFormTop.addEventListener('click', () => showSubtab('logistics-history'));
  if (btnCancelForm) btnCancelForm.addEventListener('click', () => showSubtab('logistics-history'));

  // Logistics History Search & Filter
  const logSearch = document.getElementById('logisticsSearchInput');
  const logExpFilter = document.getElementById('logisticsExpFilter');
  if (logSearch) logSearch.addEventListener('input', () => renderLogisticsSection());
  if (logExpFilter) logExpFilter.addEventListener('change', () => renderLogisticsSection());

  // Dynamic Form: Add Item Row
  const btnAddItemRow = document.getElementById('btnAddItemRow');
  if (btnAddItemRow) {
    btnAddItemRow.addEventListener('click', () => addFormItemRow());
  }

  // Logistics Form Submission
  const fakturForm = document.getElementById('fakturForm');
  if (fakturForm) {
    fakturForm.addEventListener('submit', handleFakturFormSubmit);
  }

  // STB Photo Upload & Drop Zone
  const stbDropZone = document.getElementById('stbDropZone');
  const stbFileInput = document.getElementById('stbFileInput');
  const btnRemoveStb = document.getElementById('btnRemoveStb');

  if (stbFileInput) {
    stbFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const compressed = await compressImage(file);
        AppState.logisticsForm.stbPhoto = {
          file,
          base64: compressed.base64,
          name: file.name
        };

        const img = document.getElementById('stbPreviewImg');
        const nameEl = document.getElementById('stbFileName');
        const emptyState = document.getElementById('stbEmptyState');
        const previewWrap = document.getElementById('stbPreviewContainer');

        if (img) img.src = compressed.base64;
        if (nameEl) nameEl.textContent = `${file.name} (${Math.round(compressed.sizeAfter / 1024)} KB)`;
        if (emptyState) emptyState.style.display = 'none';
        if (previewWrap) previewWrap.style.display = 'block';

      } catch (err) {
        showToast('Gagal Membaca Gambar', err.message, 'error');
      }
    });
  }

  if (btnRemoveStb) {
    btnRemoveStb.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.logisticsForm.stbPhoto = null;
      if (stbFileInput) stbFileInput.value = '';
      const emptyState = document.getElementById('stbEmptyState');
      const previewWrap = document.getElementById('stbPreviewContainer');
      if (emptyState) emptyState.style.display = 'block';
      if (previewWrap) previewWrap.style.display = 'none';
    });
  }

  // Other Documents Photo Upload & Drop Zone (Multiple)
  const otherDocsFileInput = document.getElementById('otherDocsFileInput');
  const otherGallery = document.getElementById('otherDocsGallery');

  if (otherDocsFileInput && otherGallery) {
    otherDocsFileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      for (const file of files) {
        try {
          const compressed = await compressImage(file);
          const photoObj = {
            id: 'doc_' + Math.random().toString(36).substr(2, 9),
            file,
            base64: compressed.base64,
            name: file.name
          };
          AppState.logisticsForm.otherDocsPhotos.push(photoObj);

          // Add card to gallery
          const thumb = document.createElement('div');
          thumb.className = 'multi-thumb-card';
          thumb.id = photoObj.id;
          thumb.innerHTML = `
            <img src="${compressed.base64}" alt="${escapeHtml(file.name)}">
            <button type="button" class="multi-thumb-remove" title="Hapus Foto">&times;</button>
          `;

          thumb.querySelector('.multi-thumb-remove').addEventListener('click', () => {
            AppState.logisticsForm.otherDocsPhotos = AppState.logisticsForm.otherDocsPhotos.filter(p => p.id !== photoObj.id);
            thumb.remove();
          });

          otherGallery.appendChild(thumb);
        } catch (err) {
          showToast('Foto Diabaikan', err.message, 'warning');
        }
      }
      otherDocsFileInput.value = '';
    });
  }

  // Manual Upload Fallback Listeners in Modal Tab 2
  setupManualExcelUploads();
}

/**
 * Setup Manual Upload for local Excel (.xlsx) files via SheetJS
 */
function setupManualExcelUploads() {
  const handleFileUpload = (inputEl, parserFn, onSuccessMsg) => {
    if (!inputEl) return;
    inputEl.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          await parserFn(workbook);
          renderAllViews();
          showToast('File Berhasil Diproses', onSuccessMsg, 'success');
        } catch (err) {
          console.error(err);
          showToast('Gagal Parsing File', err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  handleFileUpload(
    document.getElementById('manualFileCoreApp'),
    async (wb) => {
      const catalog = parseCoreAppWorkbook(wb);
      AppState.databasesCatalog = catalog;
      await DB.bulkPut('databases_catalog', catalog);
      renderDetectedDatabases(catalog);
    },
    'File Core App berhasil dimuat.'
  );

  handleFileUpload(
    document.getElementById('manualFileStock'),
    async (wb) => {
      const records = parseStockOpnameWorkbook(wb);
      AppState.stockRecords = records;
      const { sales, sortedDates } = computeSalesFromStock(AppState.stockRecords, AppState.priceList);
      AppState.salesRecords = sales;
      AppState.stockDates = sortedDates;
      AppState.selectedStockDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : '';
      AppState.products = consolidateProducts(AppState.priceList, AppState.stockRecords, AppState.salesRecords, sortedDates);

      await DB.bulkPut('stock_history', records);
      await DB.bulkPut('sales_records', sales);
      await DB.bulkPut('products', AppState.products);
    },
    'File Stok Opname berhasil dimuat & dikalkulasi.'
  );

  handleFileUpload(
    document.getElementById('manualFilePrice'),
    async (wb) => {
      AppState.priceList = parsePriceListWorkbook(wb);
      const { sales, sortedDates } = computeSalesFromStock(AppState.stockRecords, AppState.priceList);
      AppState.salesRecords = sales;
      AppState.products = consolidateProducts(AppState.priceList, AppState.stockRecords, AppState.salesRecords, sortedDates);

      await DB.bulkPut('sales_records', sales);
      await DB.bulkPut('products', AppState.products);
    },
    'File Daftar Harga berhasil diperbarui.'
  );

  handleFileUpload(
    document.getElementById('manualFileLogistics'),
    async (wb) => {
      const invoices = parseLogisticsWorkbook(wb);
      AppState.invoices = invoices;
      await DB.bulkPut('invoices', invoices);
    },
    'File Faktur Logistik berhasil diimpor.'
  );
}

/* ============================================================================
   APPLICATION BOOTSTRAPPER
   ============================================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Initialize IndexedDB
    await DB.init();

    // 2. Load cached config and data
    const savedConfig = await DB.get('config', 'mainConfig');
    if (savedConfig) {
      AppState.config = { ...AppState.config, ...savedConfig };
      const urlInput = document.getElementById('inputCoreAppUrl');
      const scriptInput = document.getElementById('inputScriptUrl');
      const driveInput = document.getElementById('inputDriveFolderUrl');
      if (urlInput) urlInput.value = AppState.config.coreAppUrl || DEFAULT_CONFIG.CORE_APP_URL;
      if (scriptInput) scriptInput.value = AppState.config.scriptUrl || DEFAULT_CONFIG.SCRIPT_URL;
      if (driveInput) driveInput.value = AppState.config.driveFolderUrl || DEFAULT_CONFIG.DRIVE_FOLDER_URL;
    }

    // Load cached data from IndexedDB
    const [cachedCatalog, cachedProducts, cachedStock, cachedSales, cachedInvoices] = await Promise.all([
      DB.getAll('databases_catalog'),
      DB.getAll('products'),
      DB.getAll('stock_history'),
      DB.getAll('sales_records'),
      DB.getAll('invoices')
    ]);

    if (cachedCatalog && cachedCatalog.length > 0) AppState.databasesCatalog = cachedCatalog;
    if (cachedProducts && cachedProducts.length > 0) AppState.products = cachedProducts;
    if (cachedStock && cachedStock.length > 0) AppState.stockRecords = cachedStock;
    if (cachedSales && cachedSales.length > 0) AppState.salesRecords = cachedSales;
    if (cachedInvoices && cachedInvoices.length > 0) AppState.invoices = cachedInvoices;

    // Extract sorted dates from stock
    const dates = Array.from(new Set(AppState.stockRecords.map(r => r.tgl_opname))).sort((a, b) => {
      const da = parseDateString(a) || new Date(0);
      const db = parseDateString(b) || new Date(0);
      return da - db;
    });
    AppState.stockDates = dates;
    if (dates.length > 0) AppState.selectedStockDate = dates[dates.length - 1];

    // Reconstruct priceList map from cached products
    AppState.products.forEach(p => {
      AppState.priceList.set(p.nama_produk, { producer: p.produsen, price: p.harga });
    });

    // 3. Setup Navigation & Interactions
    setupNavigation();
    setupInteractions();

    // 4. Initialize Real Authentication Gateway
    AuthManager.init();

    // 5. If database is completely empty on first launch, load rich Demo Data automatically!
    if (AppState.products.length === 0 && AppState.invoices.length === 0) {
      await loadDemoData();
    } else {
      renderDetectedDatabases(AppState.databasesCatalog);
      renderAllViews();
    }

    // Initialize blank row in Logistics form
    resetLogisticsForm();

  } catch (err) {
    console.error('Bootstrap error:', err);
    showToast('Inisialisasi', 'Aplikasi siap digunakan.', 'info');
  }
});

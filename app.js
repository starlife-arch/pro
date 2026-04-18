const STORAGE_KEY = "starlife-assets-v1";

const PRICE_LIMITS = {
  min: 10,
  max: 5_000_000,
  rentMin: 5,
  rentMax: 200_000,
  listingMin: 5,
  listingMax: 200_000,
};

const SHIPPING_COORDS = {
  lagos: { x: 1, y: 1 },
  abuja: { x: 5, y: 4 },
  london: { x: 12, y: 9 },
  dubai: { x: 8, y: 2 },
  tokyo: { x: 15, y: 5 },
  "new york": { x: 2, y: 10 },
  miami: { x: 3, y: 8 },
  dallas: { x: 4, y: 7 },
};

const SHIPPING_MULTIPLIERS = { small: 1.2, medium: 2.1, large: 3.6 };
const PLATFORM_FEE_RATE = 0.05;
const LISTING_FEE = 15;
const MAJOR_ASSET_THRESHOLD = 40000;

const state = loadState();
let activeUserId = state.users[0].id;
let signatureTargetContractId = null;
let pendingAssetImages = [];

init();

function init() {
  wireTabs();
  wireForm();
  wireFilters();
  wireDialogs();
  renderAll();
}

function loadState() {
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) return JSON.parse(cached);

  const demo = {
    users: [
      { id: "u1", name: "Amara", role: "user", mainBalance: 220000, heldBalance: 8000, vip: true },
      { id: "u2", name: "Bola", role: "user", mainBalance: 120000, heldBalance: 5000, vip: false },
      { id: "u3", name: "Tobi", role: "user", mainBalance: 450000, heldBalance: 40000, vip: false },
      { id: "admin", name: "Starlife Admin", role: "admin", mainBalance: 0, heldBalance: 0, vip: true },
    ],
    assets: [
      {
        id: makeId("asset"),
        name: "Skyline Mini Apartment",
        type: "house",
        description: "One bedroom apartment in city center",
        location: "Lagos",
        originLocation: "Lagos",
        fullPrice: 180000,
        rentPrice: 13000,
        paymentInterval: "monthly",
        ownershipType: "rent-to-own",
        isPhysical: true,
        weightCategory: "large",
        active: true,
        vipOnly: false,
      },
      {
        id: makeId("asset"),
        name: "Nova X Pro Phone",
        type: "phone",
        description: "Flagship phone with 512GB storage",
        location: "Dubai",
        originLocation: "Dubai",
        fullPrice: 2200,
        rentPrice: 145,
        paymentInterval: "weekly",
        ownershipType: "rent-to-own",
        isPhysical: true,
        weightCategory: "small",
        active: true,
        vipOnly: false,
      },
    ],
    userAssets: [],
    listings: [],
    transactions: [],
    shipping: [],
    receipts: [],
    contracts: [],
    settings: { platformFeeRate: PLATFORM_FEE_RATE, listingFee: LISTING_FEE },
  };

  saveState(demo);
  return demo;
}

function saveState(next = state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function wireTabs() {
  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

function wireFilters() {
  ["assetTypeFilter", "assetLocationFilter", "assetPriceFilter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderAssetsTab);
  });
  document.getElementById("activeUser").addEventListener("change", (event) => {
    activeUserId = event.target.value;
    renderAll();
  });
}

function wireForm() {
  const imageInput = document.getElementById("assetImageInput");
  imageInput.addEventListener("change", async (event) => {
    await handleAssetImageSelection(event.target.files);
    imageInput.value = "";
  });

  document.getElementById("assetForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const editId = value("assetId");
    const payload = {
      name: value("assetName").trim(),
      type: value("assetType"),
      description: value("assetDescription").trim(),
      location: value("assetLocation").trim(),
      originLocation: value("assetOrigin").trim(),
      fullPrice: Number(value("assetFullPrice")),
      rentPrice: Number(value("assetRentPrice")),
      paymentInterval: value("assetInterval"),
      ownershipType: value("assetOwnershipType"),
      isPhysical: value("assetPhysical") === "yes",
      weightCategory: value("assetWeight"),
      vipOnly: value("assetVip") === "yes",
      images: [...pendingAssetImages],
      active: true,
    };

    const error = validateBasePrice(payload.fullPrice, payload.rentPrice);
    if (error) return toast(error);

    if (editId) {
      const idx = state.assets.findIndex((a) => a.id === editId);
      state.assets[idx] = { ...state.assets[idx], ...payload };
      toast("Asset updated.");
    } else {
      state.assets.push({ ...payload, id: makeId("asset") });
      toast("Asset created.");
    }

    resetAssetForm();
    saveState();
    renderAll();
  });

  document.getElementById("clearAssetForm").addEventListener("click", resetAssetForm);
}

function wireDialogs() {
  const canvas = document.getElementById("signaturePad");
  const ctx = canvas.getContext("2d");
  let drawing = false;

  const start = (x, y) => {
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (x, y) => {
    if (!drawing) return;
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#1b2e66";
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const stop = () => (drawing = false);

  canvas.addEventListener("mousedown", (e) => start(e.offsetX, e.offsetY));
  canvas.addEventListener("mousemove", (e) => draw(e.offsetX, e.offsetY));
  canvas.addEventListener("mouseup", stop);
  canvas.addEventListener("mouseleave", stop);

  document.getElementById("clearSignature").addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  document.getElementById("saveSignature").addEventListener("click", () => {
    if (!signatureTargetContractId) return;
    if (isCanvasBlank(canvas)) return toast("Please draw your signature first.");
    addContractSignature(signatureTargetContractId, activeUserId, canvas.toDataURL());
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById("signatureDialog").close();
    renderAll();
  });

  document.getElementById("closeSignature").addEventListener("click", () => {
    document.getElementById("signatureDialog").close();
  });
}

function renderAll() {
  renderTopbar();
  renderAssetsTab();
  renderMyAssets();
  renderMarketplace();
  renderAdmin();
  renderReceipts();
  renderContracts();
}

function renderTopbar() {
  const userSelect = document.getElementById("activeUser");
  userSelect.innerHTML = state.users
    .filter((u) => u.role !== "admin")
    .map((u) => `<option value="${u.id}" ${activeUserId === u.id ? "selected" : ""}>${u.name}</option>`)
    .join("");

  const current = getUser(activeUserId);
  const spendable = current.mainBalance - current.heldBalance;
  document.getElementById("balanceCard").textContent = `Main: ${money(current.mainBalance)} | Held: ${money(current.heldBalance)} | Spendable: ${money(spendable)}`;

  const types = [...new Set(state.assets.map((a) => a.type))];
  const typeFilter = document.getElementById("assetTypeFilter");
  typeFilter.innerHTML = `<option value="all">All Types</option>${types.map((t) => `<option ${t === typeFilter.value ? "selected" : ""}>${t}</option>`).join("")}`;
}

function renderAssetsTab() {
  const typeFilter = value("assetTypeFilter");
  const locationFilter = value("assetLocationFilter").toLowerCase().trim();
  const priceFilter = Number(value("assetPriceFilter")) || Infinity;
  const currentUser = getUser(activeUserId);

  const assets = state.assets.filter((asset) => {
    if (!asset.active) return false;
    if (asset.vipOnly && !currentUser.vip) return false;
    if (typeFilter !== "all" && asset.type !== typeFilter) return false;
    if (locationFilter && !asset.location.toLowerCase().includes(locationFilter)) return false;
    if (asset.fullPrice > priceFilter) return false;
    return true;
  });

  document.getElementById("assetsGrid").innerHTML = assets.map(assetCard).join("") || `<p>No assets match your filters.</p>`;

  assets.forEach((asset) => {
    const detailsBtn = document.getElementById(`details-${asset.id}`);
    const rentBtn = document.getElementById(`rent-${asset.id}`);
    const buyBtn = document.getElementById(`buy-${asset.id}`);

    detailsBtn.addEventListener("click", () => openAssetDetails(asset.id));
    rentBtn.addEventListener("click", () => acquireFromAdmin(asset.id, "rent"));
    buyBtn.addEventListener("click", () => acquireFromAdmin(asset.id, asset.ownershipType === "full-purchase" ? "purchase" : "installment"));
  });
}

function renderMyAssets() {
  const myAssets = state.userAssets.filter((ua) => ua.userId === activeUserId && ua.status !== "closed");
  const grid = document.getElementById("myAssetsGrid");
  if (!myAssets.length) {
    grid.innerHTML = `<p>You have no assets yet.</p>`;
    return;
  }

  grid.innerHTML = myAssets
    .map((ua) => {
      const asset = getAsset(ua.assetId);
      const progress = Math.min(100, Math.round((ua.totalPaid / ua.targetPrice) * 100));
      return `
      <article class="card">
        <h3>${asset.name}</h3>
        <div class="tags">
          <span class="tag">${ua.ownershipStatus}</span>
          <span class="tag">Paid: ${money(ua.totalPaid)}</span>
          <span class="tag">Remaining: ${money(ua.remainingBalance)}</span>
          <span class="tag">Earnings: ${money(ua.earnings || 0)}</span>
        </div>
        <div class="progress-wrap">
          <small>Ownership Progress</small>
          <progress value="${progress}" max="100"></progress>
        </div>
        <div class="actions">
          <button id="pay-${ua.id}" class="primary">Pay Installment</button>
          <button id="list-${ua.id}">List for Rent</button>
        </div>
      </article>`;
    })
    .join("");

  myAssets.forEach((ua) => {
    document.getElementById(`pay-${ua.id}`).addEventListener("click", () => payInstallment(ua.id));
    document.getElementById(`list-${ua.id}`).addEventListener("click", () => createListing(ua.id));
  });
}

function renderMarketplace() {
  const me = getUser(activeUserId);
  const visible = state.listings.filter((listing) => {
    if (!listing.active) return false;
    if (listing.holderUserId === me.id) return false;
    if (listing.availability === "specific" && !listing.allowedUserIds.includes(me.id)) return false;
    if (!listing.allowMultipleRents && listing.currentRenterId) return false;
    return true;
  });

  const grid = document.getElementById("marketGrid");
  if (!visible.length) {
    grid.innerHTML = `<p>No active marketplace listings right now.</p>`;
    return;
  }

  grid.innerHTML = visible
    .map((listing) => {
      const asset = getAsset(listing.assetId);
      const owner = getUser(listing.holderUserId);
      return `
      <article class="card">
        <h3>${asset.name}</h3>
        ${assetPreview(asset)}
        <div class="tags">
          <span class="tag">Owner: ${owner.name}</span>
          <span class="tag">Rent: ${money(listing.rentPrice)} / ${listing.paymentDuration}</span>
          <span class="tag">${listing.availability}</span>
          <span class="tag">${listing.featured ? "Featured" : "Standard"}</span>
        </div>
        <p>${asset.description}</p>
        <button class="primary" id="renting-${listing.id}">Rent Now</button>
      </article>`;
    })
    .join("");

  visible.forEach((listing) => {
    document.getElementById(`renting-${listing.id}`).addEventListener("click", () => rentFromListing(listing.id));
  });
}

function renderAdmin() {
  const list = document.getElementById("adminAssetList");
  list.innerHTML = state.assets
    .map((a) => `<article class="list-item">
      <strong>${a.name}</strong> (${a.type}) - ${a.active ? "Active" : "Inactive"}
      <div class="actions">
        <button id="edit-${a.id}">Edit</button>
        <button id="toggle-${a.id}">${a.active ? "Deactivate" : "Activate"}</button>
        <button id="delete-${a.id}" class="warn">Delete</button>
      </div>
    </article>`)
    .join("");

  state.assets.forEach((asset) => {
    document.getElementById(`edit-${asset.id}`).addEventListener("click", () => fillAssetForm(asset));
    document.getElementById(`toggle-${asset.id}`).addEventListener("click", () => {
      asset.active = !asset.active;
      saveState();
      renderAll();
    });
    document.getElementById(`delete-${asset.id}`).addEventListener("click", () => {
      if (!confirm("Delete asset?")) return;
      state.assets = state.assets.filter((a) => a.id !== asset.id);
      saveState();
      renderAll();
    });
  });

  const listingList = document.getElementById("adminListingList");
  listingList.innerHTML = state.listings
    .map((listing) => {
      const asset = getAsset(listing.assetId);
      return `<article class="list-item">
      <strong>${asset?.name || "Deleted Asset"}</strong> - ${money(listing.rentPrice)} - ${listing.active ? "active" : "inactive"}
      <div class="actions">
        <button id="cancel-${listing.id}" class="warn">Cancel Listing</button>
        <button id="adjust-${listing.id}">Adjust Price</button>
      </div>
      </article>`;
    })
    .join("");

  state.listings.forEach((listing) => {
    const cancel = document.getElementById(`cancel-${listing.id}`);
    const adjust = document.getElementById(`adjust-${listing.id}`);
    if (cancel) cancel.addEventListener("click", () => {
      listing.active = false;
      saveState();
      renderAll();
    });
    if (adjust) adjust.addEventListener("click", () => {
      const next = Number(prompt("New rent price", String(listing.rentPrice)));
      if (!Number.isFinite(next)) return;
      if (next < PRICE_LIMITS.listingMin || next > PRICE_LIMITS.listingMax) {
        return toast(`Rent must be between ${PRICE_LIMITS.listingMin} and ${PRICE_LIMITS.listingMax}.`);
      }
      listing.rentPrice = next;
      saveState();
      renderAll();
    });
  });
}

function renderReceipts() {
  const mine = state.receipts.filter((r) => r.senderUserId === activeUserId || r.receiverUserId === activeUserId);
  document.getElementById("receiptList").innerHTML = mine
    .map((r) => `
      <article class="list-item">
        <strong>${r.paymentType.toUpperCase()}</strong> • ${r.assetName} • ${money(r.amountPaid)}
        <div>${new Date(r.createdAt).toLocaleString()} • TX: ${r.transactionId}</div>
        <div>Sender: ${r.senderName} → Receiver: ${r.receiverName}</div>
        <button id="receipt-${r.id}">View Receipt</button>
      </article>`)
    .join("") || "<p>No receipts yet.</p>";

  mine.forEach((r) => {
    document.getElementById(`receipt-${r.id}`).addEventListener("click", () => downloadDocument(`receipt-${r.id}.html`, `Receipt ${r.id}`, r));
  });
}

function renderContracts() {
  const mine = state.contracts.filter((c) => c.parties.some((p) => p.userId === activeUserId));
  document.getElementById("contractList").innerHTML = mine
    .map((c) => {
      const meParty = c.parties.find((p) => p.userId === activeUserId);
      return `<article class="list-item">
        <strong>${c.assetName}</strong> • ${c.type}
        <div>${c.summary}</div>
        <div>Status: ${c.status} | Signed by me: ${meParty?.signed ? "yes" : "no"}</div>
        <div class="actions">
          <button id="view-contract-${c.id}">View Contract</button>
          ${meParty && !meParty.signed ? `<button id="sign-contract-${c.id}" class="primary">Sign Contract</button>` : ""}
        </div>
      </article>`;
    })
    .join("") || "<p>No contracts for this user.</p>";

  mine.forEach((c) => {
    document.getElementById(`view-contract-${c.id}`).addEventListener("click", () => downloadDocument(`contract-${c.id}.html`, `Contract ${c.id}`, c));
    const signButton = document.getElementById(`sign-contract-${c.id}`);
    if (signButton) signButton.addEventListener("click", () => openSignaturePad(c.id));
  });
}

function assetCard(asset) {
  return `<article class="card">
    <h3>${asset.name}</h3>
    ${assetPreview(asset)}
    <div class="tags">
      <span class="tag">${asset.type}</span>
      <span class="tag">${asset.ownershipType}</span>
      <span class="tag">${asset.paymentInterval}</span>
      ${asset.vipOnly ? `<span class="tag">VIP</span>` : ""}
    </div>
    <p>${asset.description}</p>
    <p><strong>Full:</strong> ${money(asset.fullPrice)}<br><strong>Rent:</strong> ${money(asset.rentPrice)}</p>
    <div class="actions">
      <button id="details-${asset.id}">Details</button>
      <button id="rent-${asset.id}">Rent Now</button>
      <button id="buy-${asset.id}" class="primary">${asset.ownershipType === "full-purchase" ? "Buy" : "Start Installment"}</button>
    </div>
  </article>`;
}

function openAssetDetails(assetId) {
  const asset = getAsset(assetId);
  const needsShipping = asset.isPhysical;
  const imageSection = (asset.images || []).length
    ? `<div class="detail-image-grid">${asset.images.map((img, idx) => `<img src="${img}" alt="${asset.name} image ${idx + 1}" />`).join("")}</div>`
    : "<p>No images uploaded for this asset yet.</p>";
  const shippingLine = needsShipping ? `<label>Destination <input id="shippingDestination" placeholder="e.g. Miami" /></label><button id="calcShipping">Calculate Shipping</button><div id="shippingResult"></div>` : "<p>No shipping required.</p>";

  document.getElementById("assetDetailContent").innerHTML = `
    <h2>${asset.name}</h2>
    ${imageSection}
    <p>${asset.description}</p>
    <p><strong>Origin:</strong> ${asset.originLocation || "N/A"} | <strong>Location:</strong> ${asset.location || "N/A"}</p>
    <p><strong>Item Price:</strong> ${money(asset.fullPrice)} | <strong>Rent:</strong> ${money(asset.rentPrice)}</p>
    ${shippingLine}
    <div class="actions"><button id="closeDetails">Close</button></div>
  `;

  document.getElementById("assetDialog").showModal();
  document.getElementById("closeDetails").addEventListener("click", () => document.getElementById("assetDialog").close());

  if (needsShipping) {
    document.getElementById("calcShipping").addEventListener("click", () => {
      const destination = document.getElementById("shippingDestination").value.trim();
      const shipping = calculateShipping(asset, destination);
      if (shipping.error) return toast(shipping.error);
      document.getElementById("shippingResult").innerHTML = `<p>Shipping Fee: ${money(shipping.fee)} | Total Purchase Cost: ${money(asset.fullPrice + shipping.fee)}</p>`;
    });
  }
}

function acquireFromAdmin(assetId, mode) {
  const asset = getAsset(assetId);
  const currentUser = getUser(activeUserId);
  const targetPrice = mode === "purchase" ? asset.fullPrice : asset.fullPrice;
  const amount = mode === "rent" ? asset.rentPrice : installmentAmount(asset);

  const destination = asset.isPhysical ? prompt("Delivery destination:")?.trim() : "";
  if (asset.isPhysical && !destination) return toast("Destination is required for physical assets.");

  const shippingResult = asset.isPhysical ? calculateShipping(asset, destination) : { fee: 0 };
  if (shippingResult.error) return toast(shippingResult.error);

  const totalCharge = amount + shippingResult.fee;
  if (!canSpend(currentUser, totalCharge)) return toast("Insufficient main balance (spendable check failed).");

  const tx = createTransaction({
    fromUserId: currentUser.id,
    toUserId: "platform",
    assetId,
    amount,
    paymentType: mode,
    shippingFee: shippingResult.fee,
    meta: { destination },
  });

  let userAsset = state.userAssets.find((ua) => ua.userId === currentUser.id && ua.assetId === assetId && ua.status !== "closed");
  if (!userAsset) {
    userAsset = {
      id: makeId("ua"),
      userId: currentUser.id,
      assetId,
      originOwner: "platform",
      mode,
      totalPaid: 0,
      targetPrice,
      remainingBalance: targetPrice,
      ownershipStatus: mode === "rent" ? "renting" : "partial owner",
      earnings: 0,
      createdAt: new Date().toISOString(),
      status: "active",
      destination,
    };
    state.userAssets.push(userAsset);
  }

  userAsset.totalPaid += amount;
  userAsset.remainingBalance = Math.max(0, targetPrice - userAsset.totalPaid);
  userAsset.ownershipStatus = inferOwnershipStatus(userAsset, mode);

  if (shippingResult.fee > 0) {
    state.shipping.push({
      id: makeId("ship"),
      assetId,
      userAssetId: userAsset.id,
      fromLocation: asset.originLocation || asset.location,
      toLocation: destination,
      weightCategory: asset.weightCategory,
      distance: shippingResult.distance,
      fee: shippingResult.fee,
      transactionId: tx.id,
      createdAt: new Date().toISOString(),
    });
  }

  maybeCreateContract({
    asset,
    buyerId: currentUser.id,
    sellerId: "platform",
    amount,
    mode,
    duration: asset.paymentInterval,
    isUserToUser: false,
  });

  saveState();
  renderAll();
  toast(`Payment successful. Charged ${money(totalCharge)} including shipping ${money(shippingResult.fee)}.`);
}

function payInstallment(userAssetId) {
  const ua = state.userAssets.find((item) => item.id === userAssetId);
  if (!ua || ua.ownershipStatus === "fully owned") return;
  const asset = getAsset(ua.assetId);
  const amount = Math.min(installmentAmount(asset), ua.remainingBalance);
  const user = getUser(activeUserId);

  if (!canSpend(user, amount)) return toast("Insufficient spendable balance.");

  createTransaction({
    fromUserId: user.id,
    toUserId: ua.originOwner === "platform" ? "platform" : ua.originOwner,
    assetId: ua.assetId,
    amount,
    paymentType: "installment",
    shippingFee: 0,
    meta: { userAssetId: ua.id },
  });

  ua.totalPaid += amount;
  ua.remainingBalance = Math.max(0, ua.targetPrice - ua.totalPaid);
  ua.ownershipStatus = inferOwnershipStatus(ua, ua.mode);

  saveState();
  renderAll();
  toast("Installment paid.");
}

function createListing(userAssetId) {
  const ua = state.userAssets.find((item) => item.id === userAssetId);
  if (!ua) return;
  if (!["renting", "partial owner", "fully owned"].includes(ua.ownershipStatus)) return toast("You cannot list this asset.");

  const existing = state.listings.find((l) => l.userAssetId === ua.id && l.active);
  if (existing) return toast("You already have an active listing for this asset.");

  const rentPrice = Number(prompt(`Set rent price (${PRICE_LIMITS.listingMin}-${PRICE_LIMITS.listingMax})`, "120"));
  if (!Number.isFinite(rentPrice) || rentPrice < PRICE_LIMITS.listingMin || rentPrice > PRICE_LIMITS.listingMax) {
    return toast("Invalid listing rent price.");
  }

  const paymentDuration = prompt("Payment duration (daily/weekly/monthly)", "weekly") || "weekly";
  const availability = prompt("Availability (open/specific)", "open") || "open";
  const allowMultipleRents = (prompt("Allow multiple simultaneous renters? (yes/no)", "no") || "no") === "yes";
  const featured = (prompt("Featured listing? Requires listing fee. (yes/no)", "no") || "no") === "yes";
  const allowedUserRaw = availability === "specific" ? (prompt("Allowed user IDs comma-separated (e.g. u2,u3)", "") || "") : "";

  const holder = getUser(ua.userId);
  const listingFee = featured ? state.settings.listingFee : 0;
  if (listingFee > 0 && !canSpend(holder, listingFee)) return toast("Not enough spendable balance for listing fee.");
  if (listingFee > 0) {
    holder.mainBalance -= listingFee;
    createTransaction({
      fromUserId: holder.id,
      toUserId: "platform",
      assetId: ua.assetId,
      amount: listingFee,
      paymentType: "listing-fee",
      shippingFee: 0,
      meta: { userAssetId: ua.id },
      skipContract: true,
    });
  }

  state.listings.push({
    id: makeId("listing"),
    userAssetId: ua.id,
    assetId: ua.assetId,
    holderUserId: ua.userId,
    rentPrice,
    paymentDuration,
    availability,
    allowedUserIds: allowedUserRaw.split(",").map((v) => v.trim()).filter(Boolean),
    active: true,
    allowMultipleRents,
    currentRenterId: null,
    featured,
    originLocation: ua.destination || holder.defaultLocation || getAsset(ua.assetId).originLocation || getAsset(ua.assetId).location,
    createdAt: new Date().toISOString(),
  });

  saveState();
  renderAll();
  toast("Listing created.");
}

function rentFromListing(listingId) {
  const listing = state.listings.find((l) => l.id === listingId);
  if (!listing || !listing.active) return;
  if (!listing.allowMultipleRents && listing.currentRenterId) return toast("This listing is already rented.");

  const renter = getUser(activeUserId);
  const owner = getUser(listing.holderUserId);
  const asset = getAsset(listing.assetId);

  const destination = asset.isPhysical ? prompt("Delivery destination:")?.trim() : "";
  if (asset.isPhysical && !destination) return toast("Destination required.");

  const sourceLocation = listing.originLocation || asset.originLocation || asset.location;
  const shippingResult = asset.isPhysical ? calculateShipping(asset, destination, sourceLocation) : { fee: 0, distance: 0 };
  if (shippingResult.error) return toast(shippingResult.error);

  const fee = Math.round(listing.rentPrice * state.settings.platformFeeRate);
  const totalCharge = listing.rentPrice + shippingResult.fee;

  if (!canSpend(renter, totalCharge)) return toast("Insufficient spendable balance.");

  renter.mainBalance -= totalCharge;
  owner.mainBalance += listing.rentPrice - fee;

  const tx = createTransaction({
    fromUserId: renter.id,
    toUserId: owner.id,
    assetId: listing.assetId,
    amount: listing.rentPrice,
    paymentType: "rent",
    shippingFee: shippingResult.fee,
    meta: { listingId },
    skipBalanceMovement: true,
  });

  const ownerUa = state.userAssets.find((ua) => ua.id === listing.userAssetId);
  ownerUa.earnings = (ownerUa.earnings || 0) + (listing.rentPrice - fee);

  const renterUa = {
    id: makeId("ua"),
    userId: renter.id,
    assetId: listing.assetId,
    originOwner: owner.id,
    mode: "rent",
    totalPaid: listing.rentPrice,
    targetPrice: asset.fullPrice,
    remainingBalance: Math.max(0, asset.fullPrice - listing.rentPrice),
    ownershipStatus: "renting",
    earnings: 0,
    status: "active",
    createdAt: new Date().toISOString(),
    destination,
  };
  state.userAssets.push(renterUa);

  if (!listing.allowMultipleRents) listing.currentRenterId = renter.id;

  if (shippingResult.fee > 0) {
    state.shipping.push({
      id: makeId("ship"),
      assetId: asset.id,
      userAssetId: renterUa.id,
      fromLocation: sourceLocation,
      toLocation: destination,
      weightCategory: asset.weightCategory,
      distance: shippingResult.distance,
      fee: shippingResult.fee,
      transactionId: tx.id,
      createdAt: new Date().toISOString(),
    });
  }

  maybeCreateContract({
    asset,
    buyerId: renter.id,
    sellerId: owner.id,
    amount: listing.rentPrice,
    mode: "rent",
    duration: listing.paymentDuration,
    isUserToUser: true,
  });

  saveState();
  renderAll();
  toast(`Rented from ${owner.name}. Platform fee charged on owner payout: ${money(fee)}.`);
}

function createTransaction({ fromUserId, toUserId, assetId, amount, paymentType, shippingFee, meta = {}, skipContract = false, skipBalanceMovement = false }) {
  const sender = getUser(fromUserId);
  const receiver = toUserId === "platform" ? { id: "platform", name: "Starlife Platform" } : getUser(toUserId);

  const charge = amount + shippingFee;
  if (!skipBalanceMovement) {
    sender.mainBalance -= charge;
    if (toUserId !== "platform") receiver.mainBalance += amount;
  }

  const tx = {
    id: makeId("tx"),
    assetId,
    fromUserId,
    toUserId,
    amount,
    shippingFee,
    paymentType,
    meta,
    createdAt: new Date().toISOString(),
  };
  state.transactions.push(tx);

  createReceipt(tx, sender, receiver);

  if (!skipContract) {
    const asset = getAsset(assetId);
    maybeCreateContract({
      asset,
      buyerId: fromUserId,
      sellerId: toUserId,
      amount,
      mode: paymentType,
      duration: asset.paymentInterval,
      isUserToUser: toUserId !== "platform",
    });
  }

  return tx;
}

function createReceipt(tx, sender, receiver) {
  const asset = getAsset(tx.assetId);
  state.receipts.push({
    id: makeId("receipt"),
    transactionId: tx.id,
    userName: sender.name,
    assetName: asset?.name || "Unknown Asset",
    amountPaid: tx.amount + tx.shippingFee,
    baseAmount: tx.amount,
    shippingFee: tx.shippingFee,
    createdAt: tx.createdAt,
    paymentType: tx.paymentType,
    senderUserId: tx.fromUserId,
    receiverUserId: tx.toUserId,
    senderName: sender.name,
    receiverName: receiver.name,
  });
}

function maybeCreateContract({ asset, buyerId, sellerId, amount, mode, duration, isUserToUser }) {
  const majorType = ["house", "car"].includes(asset.type);
  const isMajor = majorType || asset.fullPrice >= MAJOR_ASSET_THRESHOLD || ["monthly"].includes(duration);
  if (!isMajor && mode !== "rent") return;

  const duplicate = state.contracts.find((c) => c.assetId === asset.id && c.buyerId === buyerId && c.sellerId === sellerId && c.status !== "completed");
  if (duplicate) return;

  const buyer = getUser(buyerId);
  const sellerName = sellerId === "platform" ? "Starlife Platform" : getUser(sellerId).name;

  const parties = [
    { userId: buyerId, name: buyer.name, role: "buyer/renter", signed: false, signedAt: null, signatureData: null },
    { userId: sellerId, name: sellerName, role: "seller", signed: sellerId === "platform", signedAt: sellerId === "platform" ? new Date().toISOString() : null, signatureData: sellerId === "platform" ? "SYSTEM_SIGNATURE_STARLIFE" : null },
  ];

  state.contracts.push({
    id: makeId("contract"),
    assetId: asset.id,
    assetName: asset.name,
    buyerId,
    sellerId,
    type: isUserToUser ? "user-to-user" : "platform",
    price: amount,
    duration,
    paymentTerms: `${mode} on ${asset.paymentInterval} interval`,
    agreedDate: new Date().toISOString(),
    summary: `${buyer.name} agrees to ${mode} ${asset.name} for ${money(amount)} (${duration}).`,
    parties,
    status: "pending-signatures",
    immutableAfterSigning: true,
  });
}

function addContractSignature(contractId, userId, signatureData) {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract || contract.status === "active") return;
  const party = contract.parties.find((p) => p.userId === userId);
  if (!party || party.signed) return;

  party.signed = true;
  party.signedAt = new Date().toISOString();
  party.signatureData = signatureData;

  const allSigned = contract.parties.every((p) => p.signed);
  if (allSigned) contract.status = "active";

  saveState();
  toast(allSigned ? "Contract fully signed and active." : "Signature captured.");
}

function openSignaturePad(contractId) {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return;
  signatureTargetContractId = contractId;
  document.getElementById("signatureContractInfo").textContent = `Contract: ${contract.assetName} • ${contract.summary}`;
  document.getElementById("signatureDialog").showModal();
}

function calculateShipping(asset, destination, fromLocation = null) {
  const from = normalizeLocation(fromLocation || asset.originLocation || asset.location);
  const to = normalizeLocation(destination);
  if (!SHIPPING_COORDS[from] || !SHIPPING_COORDS[to]) {
    return { error: "Unsupported location for shipping quote. Try Lagos, Abuja, Dubai, London, Tokyo, New York, Miami or Dallas." };
  }
  const dx = SHIPPING_COORDS[from].x - SHIPPING_COORDS[to].x;
  const dy = SHIPPING_COORDS[from].y - SHIPPING_COORDS[to].y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const fee = Math.max(8, Math.round(distance * 12 * SHIPPING_MULTIPLIERS[asset.weightCategory]));
  return { distance, fee };
}

function canSpend(user, amount) {
  return user.mainBalance - user.heldBalance >= amount;
}

function validateBasePrice(fullPrice, rentPrice) {
  if (fullPrice <= 0 || rentPrice <= 0) return "Prices must be positive.";
  if (fullPrice < PRICE_LIMITS.min || fullPrice > PRICE_LIMITS.max) return `Full price must be between ${PRICE_LIMITS.min} and ${PRICE_LIMITS.max}.`;
  if (rentPrice < PRICE_LIMITS.rentMin || rentPrice > PRICE_LIMITS.rentMax) return `Rent price must be between ${PRICE_LIMITS.rentMin} and ${PRICE_LIMITS.rentMax}.`;
  return null;
}

function inferOwnershipStatus(userAsset, mode) {
  if (mode === "rent") return "renting";
  if (userAsset.remainingBalance <= 0) return "fully owned";
  return "partial owner";
}

function installmentAmount(asset) {
  const steps = asset.paymentInterval === "daily" ? 30 : asset.paymentInterval === "weekly" ? 12 : 6;
  return Math.max(20, Math.round(asset.fullPrice / steps));
}

function fillAssetForm(asset) {
  setValue("assetId", asset.id);
  setValue("assetName", asset.name);
  setValue("assetType", asset.type);
  setValue("assetDescription", asset.description);
  setValue("assetLocation", asset.location || "");
  setValue("assetOrigin", asset.originLocation || "");
  setValue("assetFullPrice", asset.fullPrice);
  setValue("assetRentPrice", asset.rentPrice);
  setValue("assetInterval", asset.paymentInterval);
  setValue("assetOwnershipType", asset.ownershipType);
  setValue("assetPhysical", asset.isPhysical ? "yes" : "no");
  setValue("assetWeight", asset.weightCategory);
  setValue("assetVip", asset.vipOnly ? "yes" : "no");
  pendingAssetImages = [...(asset.images || [])];
  renderAssetImagePreview();
}

function resetAssetForm() {
  ["assetId", "assetName", "assetDescription", "assetLocation", "assetOrigin", "assetFullPrice", "assetRentPrice"].forEach((id) => setValue(id, ""));
  setValue("assetType", "house");
  setValue("assetInterval", "daily");
  setValue("assetOwnershipType", "rent-only");
  setValue("assetPhysical", "yes");
  setValue("assetWeight", "small");
  setValue("assetVip", "no");
  pendingAssetImages = [];
  renderAssetImagePreview();
}

async function handleAssetImageSelection(files) {
  const picks = [...(files || [])];
  for (const file of picks) {
    if (pendingAssetImages.length >= 3) {
      toast("You can upload a maximum of 3 images.");
      break;
    }
    const error = validateAssetImage(file);
    if (error) {
      toast(error);
      continue;
    }
    const dataUrl = await compressImg(file);
    pendingAssetImages.push(dataUrl);
  }
  renderAssetImagePreview();
}

function renderAssetImagePreview() {
  const wrap = document.getElementById("assetImagePreview");
  wrap.innerHTML = pendingAssetImages.length
    ? pendingAssetImages
      .map((img, idx) => `
      <div class="img-preview-card">
        <img src="${img}" alt="Asset preview ${idx + 1}" />
        <button type="button" data-remove-image="${idx}" class="warn">Remove image</button>
      </div>`)
      .join("")
    : "<small>No images selected.</small>";

  wrap.querySelectorAll("[data-remove-image]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeImage);
      pendingAssetImages.splice(idx, 1);
      renderAssetImagePreview();
    });
  });
}

function validateAssetImage(file) {
  if (!file.type.startsWith("image/")) return "Only image files are allowed.";
  if (file.size > 1500 * 1024) return "Image too large. Max allowed size is 1.5MB before compression.";
  return null;
}

function compressImg(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 800;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => reject(new Error("Unable to load image."));
      img.src = event.target.result;
    };
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });
}

function assetPreview(asset) {
  const firstImage = asset.images?.[0];
  if (!firstImage) return "";
  return `<img class="asset-cover" src="${firstImage}" alt="${asset.name}" />`;
}

function getAsset(id) {
  return state.assets.find((asset) => asset.id === id);
}

function getUser(id) {
  return state.users.find((user) => user.id === id);
}

function setValue(id, val) { document.getElementById(id).value = val; }
function value(id) { return document.getElementById(id).value; }

function normalizeLocation(value) {
  return (value || "").toLowerCase().trim();
}

function money(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 2200);
}

function downloadTextFile(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadDocument(name, title, data) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(raw) {
  return String(raw).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function isCanvasBlank(canvas) {
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] !== 0) return false;
  }
  return true;
}

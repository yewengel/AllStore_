# AllStore - MERN Stack E-Commerce Platform
> **Shop Smart. Live Better.**
> **University Capstone Project**  
> Full-Stack Retail Web Application built with MongoDB, Express.js, React.js, and Node.js.

---

## 1. Project Overview

**AllStore** is a modern, responsive, full-stack e-commerce web application engineered for small-to-medium retail businesses. The platform enables customers to browse a dynamic catalog, search and filter items, manage a shopping cart, and place orders with real-time stock deduction. It simultaneously provides a secure, role-protected administrative dashboard where store owners manage product inventory (including image uploads via Multer) and update customer order fulfillment statuses.

### Tech Stack
* **Database:** MongoDB Atlas (Cloud NoSQL Database with Mongoose ODM)
* **Backend:** Node.js & Express.js (RESTful API architecture)
* **Frontend:** React 19, Vite, React Router 7, Axios
* **Authentication:** JSON Web Tokens (JWT) & Bcrypt password hashing
* **File Uploads:** Multer multipart/form-data storage
* **Styling:** Custom responsive CSS design system (zero third-party CSS dependencies)

---

## 2. User Roles & Permissions

| Capability | Customer (Default) | Admin (Store Owner) |
|---|:---:|:---:|
| User Registration & Login | ✅ | ✅ |
| Browse, Search & Filter Products | ✅ | ✅ |
| Product Details View | ✅ | ✅ |
| Add to Cart & Checkout | ✅ | ❌ |
| Automatic Stock Deduction on Order | ✅ | ❌ |
| View Personal Order History ("My Orders") | ✅ | ❌ |
| Create, Update, Delete Products | ❌ | ✅ |
| Upload Product Images via Multer | ❌ | ✅ |
| View All Orders from All Customers | ❌ | ✅ |
| Update Order Status (`Pending` &rarr; `Delivered`) | ❌ | ✅ |
| Access Admin Dashboard (`/admin`) | ❌ (Returns `403 Forbidden`) | ✅ |

---

## 3. Core Features

### A. Authentication & Authorization
* **JWT Authentication:** Tokens are signed by the backend and verified on every protected request.
* **Bcrypt Password Hashing:** Passwords are never stored in plain text; hashed using 10 salt rounds before persistence.
* **Role-Based Middleware:**
  * `protect`: Verifies the Bearer token in the `Authorization` header.
  * `admin`: Verifies `req.user.role === 'admin'`. Returns `403 Forbidden` if a customer attempts unauthorized access.

### B. Product Management (Admin)
* Admins can create new products with: `name`, `description`, `price`, `category`, `stockQuantity`, and `image`.
* **Multer File Upload:** Real image uploads (`JPG`, `PNG`, `WEBP`) processed and served statically at `/uploads`.
* Product updates with optional image replacements and complete product deletion with database cleanup.

### C. Product Browsing (Customer)
* Real-time search bar querying products by name (`$regex`).
* Category filtering for Women's Fashion, Men's Fashion, Electronics, Jewelry & Accessories, Beauty & Health, Toys & Games, Home & Kitchen, Sports & Entertainment, Party & Decor, and School & Office.
* ETB price threshold filters (`maxPrice`) and multi-option sorting (`newest`, `price-asc`, `price-desc`, `name-asc`).
* Dedicated Product Details view with responsive image gallery, quantity selectors, and live stock indicators.

### D. Shopping Cart & Checkout
* Local state and `localStorage` persistence for instant, reliable cart retention across page reloads.
* Subtotal calculations, free shipping thresholds, and item quantity adjusters.
* **Database Stock Management:** Placing an order decreases each product's `stockQuantity` atomically. If quantity is insufficient, the transaction is rejected with an informative message.
* Customer-facing product prices use the selected currency (USD by default; ETB, EUR, GBP, CHF, CAD, and MXN are available). Configure the `VITE_<CURRENCY>_PER_USD` rates in `frontend/.env` as units of that currency per USD. Non-ETB fallbacks are a reference snapshot from 2026-11-12; ETB stays at `164.62` to match the backend. Refresh rates for production. Admin analytics continue to show ETB and USD together.
* New and edited product prices are entered and stored in ETB. Existing products and historical orders are not migrated: records without a currency marker are treated as legacy USD, and new orders store ETB snapshots.

### E. Customer Order Management
* Authenticated customers can search, filter, and sort their order history, view order totals and product snapshots, and see order-count summaries.
* New orders receive a backend-generated, sequential customer-facing ID (`AS-00001`, `AS-00002`, etc.); the atomic MongoDB counter is incremented within the order transaction. MongoDB `_id` values remain in use for database relationships and API operations.
* On backend startup, existing orders with legacy or missing readable IDs are assigned short IDs without changing their MongoDB `_id` values.
* Dedicated order details and tracking pages show payment, delivery, pricing, and timestamped status-history information.
* Administrators can search and filter by order/customer/payment status, sort by date or converted order amount, review full customer/address/product/payment details, and update status separately from delivery information. The orders table and detail modal show `Pending`, `Paid`, or `Failed` payment status; the current `isPaid` flag continues to take precedence for paid orders.
* Status updates accept only the next fulfillment stage (or eligible pre-shipment cancellation), use an atomic compare-and-set, and append previous/new status, timestamp, admin note, and admin user ID to history. The admin modal offers direct actions for each allowed next step and displays history oldest to newest with timezone-aware timestamps. Payment status is not changed by shipment updates.
* Delivery tracking supports AllStore Delivery by default, optional tracking and delivery-person details, estimated/shipping/actual delivery dates, customer instructions, admin tracking notes, and transaction references. Legacy orders receive missing tracking defaults and a history entry when needed.
* Checkout collects a delivery phone number and stores it with the order.
* Customers can buy available products again and cancel unpaid orders only while they are `Pending` or `Confirmed`; cancellation restores their stock in the same database transaction.
* Customers can view only their own order details and tracking. Admins retain access to all orders and manage fulfillment using the existing dashboard.
* Order statuses: `Pending`, `Confirmed`, `Processing`, `Shipped`, `Out for Delivery`, `Delivered`, and `Cancelled`.

### F. Payments
* Chapa is used through its hosted checkout and server-side initialize/verify APIs. The application stores no card number or CVV and never trusts a browser return as proof of payment.
* Configure `CHAPA_MODE` (`test` or `live`), `CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET`, and an externally reachable `API_PUBLIC_URL` in the backend environment. Test mode rejects live-form keys and live mode rejects test keys. Never place either secret in frontend environment variables.
* `CHAPA_AVAILABLE_METHODS` is an optional comma-separated display list copied from the enabled methods in the merchant account. It does not override Chapa’s hosted checkout; the provider checkout remains authoritative. Omit PayPal unless it is enabled for both the Chapa provider and merchant account.
* Chapa payment status is updated only after backend verification of transaction reference, amount, and currency. Signed webhooks are verified and then re-checked through Chapa’s verification API; repeated callbacks are idempotent.
* Manual bank transfer is available only after setting `BANK_TRANSFER_BANK_NAME`, `BANK_TRANSFER_ACCOUNT_NAME`, and `BANK_TRANSFER_ACCOUNT_NUMBER` (optional `BANK_TRANSFER_BRANCH`). Receipt file signatures are validated; files are stored outside public static uploads and accessible only to authenticated administrators. Approval/rejection is recorded separately from order fulfillment.
* Cash on Delivery remains available without gateway configuration. Digital checkout and manual bank transfer are disabled with a configuration message when their required backend settings are missing.
* Chapa integration references: [Accept Payment](https://developer.chapa.co/integrations/accept-payments), [Verify Payment](https://developer.chapa.co/integrations/verify-payments), [Webhooks](https://developer.chapa.co/integrations/webhooks), and [Test Mode vs Live Mode](https://developer.chapa.co/integrations/test-mode-vs-live-mode).

---

## 4. REST API Documentation

### Base URL: `http://localhost:5000/api`

### Health Check
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Returns `{ status: "success", message: "..." }` |

### Authentication (`/api/auth`)
| Method | Endpoint | Access | Body / Params | Description |
|---|---|---|---|---|
| `POST` | `/api/auth/register` | Public | `{ name, email, password }` | Registers a customer, returns JWT and user profile |
| `POST` | `/api/auth/login` | Public | `{ email, password }` | Authenticates user, returns JWT and user profile |
| `GET` | `/api/auth/profile` | Private | Header: `Bearer <token>` | Returns logged-in user profile |

### Products (`/api/products`)
| Method | Endpoint | Access | Body / Params | Description |
|---|---|---|---|---|
| `GET` | `/api/products` | Public | Query: `keyword, category, maxPrice (ETB), sort` | Fetch products with search, category & price filters |
| `GET` | `/api/products/categories` | Public | None | Returns list of distinct product categories |
| `GET` | `/api/products/:id` | Public | Path: `id` | Get single product details |
| `POST` | `/api/products` | Admin | Multipart: `name, description, price (ETB), category, stockQuantity, image` | Create new ETB-priced product with Multer image upload |
| `PUT` | `/api/products/:id` | Admin | Multipart: updated fields (`price` in ETB) + optional `image` | Update existing product |
| `DELETE` | `/api/products/:id` | Admin | Path: `id` | Delete product from database |

### Orders (`/api/orders`)
| Method | Endpoint | Access | Body / Params | Description |
|---|---|---|---|---|
| `POST` | `/api/orders` | Customer | `{ orderItems: [{ product, qty }], shippingAddress, paymentMethod }` | Prices from MongoDB, assigns a readable `orderNumber` (for example `AS-00125`), stores the order in ETB, and decrements product stock |
| `GET` | `/api/orders/my-orders` | Customer | None | Returns logged-in customer's past orders |
| `GET` | `/api/orders/:id` | Owner / Admin | Path: `id` | Returns order details if owner or store admin |
| `PATCH` | `/api/orders/:id/cancel` | Owner | Path: `id` | Cancels a pending/confirmed order and returns available items to inventory |
| `GET` | `/api/orders` | Admin | None | Returns all orders from all customers |
| `PUT` | `/api/orders/:id/status` | Admin | `{ status, adminNote }` | Applies a valid next status and appends an audited history entry |
| `PATCH` | `/api/orders/:id/tracking` | Admin | Optional status, admin note, tracking and delivery fields | Updates delivery fields independently; when status changes, stores previous/new status, timestamp, admin note, and admin user ID |

No email delivery/notification integration is configured. Admin success messages confirm database updates only; customers see new status and notes when their order data is fetched again.

---

## 5. Local Development Setup

### Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher)
* [MongoDB](https://www.mongodb.com/) (Local instance or MongoDB Atlas free cloud cluster)

### Step 1: Clone the Repository
```bash
git clone <repository-url>
cd ecommerce-platform
```

### Step 2: Configure Backend Environment
Create a `.env` file in the `backend/` directory:
```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and update the variables:
```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.example.mongodb.net/ecommerce?retryWrites=true&w=majority
JWT_SECRET=super_secret_jwt_key_replace_in_production
ETB_PER_USD=164.62
```

Create `frontend/.env` from `frontend/.env.example` and keep `VITE_ETB_PER_USD` aligned with the backend rate. Set each additional `VITE_<CURRENCY>_PER_USD` value to the number of units of that currency per US dollar.
Set `VITE_SUPPORT_EMAIL` to the store's customer-support email for order support links.

### Step 3: Seed Sample Products (Optional but Recommended)
Add or update 10 sample products in each of the 10 catalog categories:
```bash
cd backend
npm run seed
```
The seeder uses the existing Product model and is safe to re-run; it does not delete products, users, or orders. Configure a working `MONGO_URI` in `backend/.env` first. Use `npm run seed:destroy` only when intentionally clearing all database data.

### Step 4: Run the Application
Open two separate terminal windows:

#### Terminal 1 — Backend:
```bash
cd backend
npm run dev
```
*Backend runs on `http://localhost:5000` with live reload via Nodemon.*

#### Terminal 2 — Frontend:
```bash
cd frontend
npm run dev
```
*Frontend runs on `http://localhost:5173` via Vite.*

---

## 6. GitHub Collaboration Workflow

Per project requirements, team members contribute via feature branches and Pull Requests:
```bash
# 1. Fetch latest main
git checkout main
git pull origin main

# 2. Create a dedicated feature branch
git checkout -b feature-auth
# or: git checkout -b feature-cart
# or: git checkout -b feature-admin

# 3. Commit your changes
git add .
git commit -m "feat(auth): add JWT authentication and role authorization"

# 4. Push branch to GitHub
git push origin feature-auth

# 5. Open a Pull Request on GitHub for peer review and merge into main
```

---

## 7. Production Deployment Guide

### A. Database (MongoDB Atlas)
1. Sign up on [MongoDB Atlas](https://www.mongodb.com/atlas) and deploy a free M0 cluster.
2. Under **Database Access**, create a user with Read and Write privileges.
3. Under **Network Access**, add IP `0.0.0.0/0` (allow access from anywhere) so cloud platforms like Render can connect.
4. Copy your connection string into your production environment variables.

### B. Backend Deployment (Render)
1. Push your project to GitHub.
2. Sign in to [Render](https://render.com/) and click **New +** &rarr; **Web Service**.
3. Select your repository.
4. Configure settings:
   * **Root Directory:** `backend`
   * **Build Command:** `npm install`
   * **Start Command:** `node server.js`
5. Add Environment Variables:
   * `NODE_ENV`: `production`
   * `PORT`: `10000`
   * `MONGO_URI`: `your_mongodb_atlas_connection_string`
   * `JWT_SECRET`: `your_secure_random_jwt_secret`
   * `ETB_PER_USD`: `164.62` (keep this in sync with the frontend's `VITE_ETB_PER_USD`)
   * `CLIENT_URL`: `https://your-frontend-domain.vercel.app`

### C. Frontend Deployment (Vercel)
1. Sign in to [Vercel](https://vercel.com/) and click **Add New** &rarr; **Project**.
2. Import your GitHub repository.
3. Configure settings:
   * **Root Directory:** `frontend`
   * **Framework Preset:** Vite
   * **Build Command:** `npm run build`
   * **Output Directory:** `dist`
4. Add Environment Variable:
   * `VITE_API_URL`: `https://your-backend-app.onrender.com/api`
   * `VITE_ETB_PER_USD`: `164.62` (keep this in sync with the backend's `ETB_PER_USD`)
   * `VITE_EUR_PER_USD`: `0.899865` (euros per US dollar)
   * `VITE_GBP_PER_USD`: `0.752421` (pounds per US dollar)
   * `VITE_CHF_PER_USD`: `0.831838` (francs per US dollar)
   * `VITE_CAD_PER_USD`: `1.423964` (Canadian dollars per US dollar)
   * `VITE_MXN_PER_USD`: `18.62736` (Mexican pesos per US dollar)
5. Click **Deploy**.

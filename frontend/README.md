# AllStore Frontend

AllStore is the customer storefront and secure admin portal for the existing MERN commerce backend.

**Shop Smart. Live Better.**

## Run locally

```bash
npm install
npm run dev
```

The development API defaults to `http://localhost:5000/api`. Production builds default
to `https://allstore-backend.onrender.com/api`; set `VITE_API_URL` in Vercel to override
the default when using a different backend. The Render backend must allow the deployed
Vercel origin through its `CLIENT_URL` or `CLIENT_URLS` setting.
The AllStore logo is served from `public/images/allstore-logo.png`.

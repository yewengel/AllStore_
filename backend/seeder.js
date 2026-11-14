const dotenv = require('dotenv');

dotenv.config();

const mongoose = require('mongoose');
const Product = require('./models/Product');
const connectDB = require('./config/db');

const categoryProducts = [
  {
    category: "Women's Fashion",
    image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&auto=format&fit=crop&q=85',
    description: 'A versatile wardrobe essential made with comfortable materials and considered everyday styling.',
    products: [
      ['Classic Tailored Blazer', 89.99],
      ['Floral Wrap Midi Dress', 64.5],
      ['High-Waisted Straight Jeans', 59.99],
      ['Ribbed Knit Cardigan', 48.0],
      ['Relaxed Cotton Blouse', 39.99],
      ['Pleated A-Line Skirt', 44.5],
      ['Lightweight Trench Coat', 119.0],
      ['Everyday Knit Sweater', 54.99],
      ['Linen Wide-Leg Trousers', 62.0],
      ['Quilted Puffer Jacket', 109.99],
    ],
  },
  {
    category: "Men's Fashion",
    image: 'https://images.unsplash.com/photo-1617137968427-85924c800a22?w=800&auto=format&fit=crop&q=85',
    description: 'A refined, comfortable piece designed for dependable wear across workdays and weekends.',
    products: [
      ['Oxford Button-Down Shirt', 49.99],
      ['Slim Fit Chino Trousers', 59.0],
      ['Merino Crewneck Sweater', 79.99],
      ['Classic Denim Jacket', 84.5],
      ['Everyday Cotton Polo', 34.99],
      ['Lightweight Bomber Jacket', 92.0],
      ['Textured Casual Blazer', 109.99],
      ['Relaxed Fit Hoodie', 54.0],
      ['Performance Jogger Pants', 46.5],
      ['Long-Sleeve Henley Shirt', 38.99],
    ],
  },
  {
    category: 'Electronics',
    image: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=800&auto=format&fit=crop&q=85',
    description: 'A practical, thoughtfully designed device with reliable performance for home or on-the-go use.',
    products: [
      ['Wireless Noise-Canceling Headphones', 199.99],
      ['Mechanical RGB Gaming Keyboard', 119.5],
      ['27-Inch 4K UHD Monitor', 349.0],
      ['Portable Bluetooth Speaker', 69.99],
      ['USB-C Multiport Hub', 42.5],
      ['Smart Fitness Watch', 159.0],
      ['Wireless Charging Stand', 35.99],
      ['1080p Streaming Webcam', 74.0],
      ['Compact Power Bank', 39.5],
      ['Noise-Isolating Earbuds', 89.99],
    ],
  },
  {
    category: 'Jewelry & Accessories',
    image: 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=800&auto=format&fit=crop&q=85',
    description: 'A versatile finishing touch, carefully selected for quality, comfort, and lasting style.',
    products: [
      ['Sterling Silver Pendant Necklace', 68.0],
      ['Minimalist Gold Hoop Earrings', 42.5],
      ['Classic Leather Bifold Wallet', 54.99],
      ['Polarized Aviator Sunglasses', 64.0],
      ['Stainless Steel Link Bracelet', 47.5],
      ['Everyday Canvas Crossbody Bag', 72.0],
      ['Slim Leather Belt', 39.99],
      ['Pearl Stud Earring Set', 35.0],
      ['Structured Everyday Tote', 84.5],
      ['Analog Mesh Strap Watch', 119.0],
    ],
  },
  {
    category: 'Beauty & Health',
    image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&auto=format&fit=crop&q=85',
    description: 'A carefully selected self-care essential made for simple, comfortable daily routines.',
    products: [
      ['Hydrating Daily Face Serum', 28.99],
      ['Gentle Foaming Facial Cleanser', 18.5],
      ['Mineral Sunscreen SPF 50', 22.0],
      ['Nourishing Hair Repair Mask', 24.99],
      ['Vitamin C Brightening Moisturizer', 32.5],
      ['Soft Bristle Makeup Brush Set', 29.0],
      ['Aromatherapy Body Lotion', 19.99],
      ['Reusable Facial Cleansing Pads', 12.5],
      ['Stainless Steel Water Bottle', 26.0],
      ['Compact Wellness First Aid Kit', 21.99],
    ],
  },
  {
    category: 'Toys & Games',
    image: 'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=800&auto=format&fit=crop&q=85',
    description: 'An engaging, durable playtime favorite designed to encourage creativity and shared fun.',
    products: [
      ['Wooden Building Block Set', 32.99],
      ['Family Strategy Board Game', 29.5],
      ['Remote-Controlled Off-Road Car', 48.0],
      ['Magnetic Tile Construction Kit', 44.99],
      ['Plush Animal Toy', 19.0],
      ['Beginner Science Experiment Kit', 36.5],
      ['Classic Wooden Jigsaw Puzzle', 16.99],
      ['Creative Modeling Clay Set', 14.5],
      ['Card Game for Family Nights', 12.0],
      ['Kids Outdoor Ring Toss Game', 23.99],
    ],
  },
  {
    category: 'Home & Kitchen',
    image: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=800&auto=format&fit=crop&q=85',
    description: 'A useful home essential combining dependable function with a clean, considered design.',
    products: [
      ['Stainless Steel French Press', 39.99],
      ['Ergonomic LED Desk Lamp', 49.99],
      ['Ceramic Nonstick Cookware Set', 129.0],
      ['Linen Blend Cushion Cover Set', 34.5],
      ['Acacia Wood Serving Board', 28.0],
      ['Cotton Waffle Bath Towel Set', 45.99],
      ['Glass Food Storage Container Set', 32.0],
      ['Minimalist Wall Clock', 41.5],
      ['Soft Knit Throw Blanket', 58.0],
      ['Bamboo Drawer Organizer Set', 24.99],
    ],
  },
  {
    category: 'Sports & Entertainment',
    image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=85',
    description: 'A durable, comfortable piece of gear built to support active days, training, and recreation.',
    products: [
      ['Adjustable Training Dumbbells', 79.99],
      ['Non-Slip Exercise Yoga Mat', 32.0],
      ['Insulated Sports Water Bottle', 24.5],
      ['Breathable Running Sneakers', 89.95],
      ['Compact Resistance Band Set', 19.99],
      ['Lightweight Day Hiking Backpack', 68.0],
      ['All-Weather Soccer Ball', 27.5],
      ['Padded Cycling Gloves', 22.0],
      ['Quick-Dry Training T-Shirt', 29.99],
      ['Portable Pickleball Paddle Set', 54.0],
    ],
  },
  {
    category: 'Party & Decor',
    image: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800&auto=format&fit=crop&q=85',
    description: 'A cheerful finishing touch to help make celebrations and special gatherings memorable.',
    products: [
      ['Reusable Party Tableware Set', 26.99],
      ['Warm White String Light Set', 34.0],
      ['Colorful Paper Garland Bunting', 14.5],
      ['Celebration Balloon Arch Kit', 29.99],
      ['Decorative Glass Bud Vase Set', 24.0],
      ['Birthday Cake Topper Collection', 12.5],
      ['Festive Printed Table Runner', 21.0],
      ['LED Tealight Candle Set', 18.99],
      ['Photo Booth Party Prop Kit', 16.5],
      ['Gift Wrap and Ribbon Bundle', 19.0],
    ],
  },
  {
    category: 'School & Office',
    image: 'https://images.unsplash.com/photo-1588072432836-e10032774350?w=800&auto=format&fit=crop&q=85',
    description: 'A reliable everyday supply selected to keep schoolwork, planning, and office tasks organized.',
    products: [
      ['Classic Everyday School Backpack', 49.99],
      ['Hardcover Ruled Notebook Set', 18.5],
      ['Retractable Ballpoint Pen Pack', 12.0],
      ['Colored Pencil and Sketch Set', 22.99],
      ['Padded Zipper Pencil Case', 14.5],
      ['Scientific Calculator', 26.0],
      ['Desktop File Organizer', 31.5],
      ['Index Cards and Study Tabs Set', 9.99],
      ['Refillable Marker Highlighter Set', 15.0],
      ['Compact Office Stapler Bundle', 17.99],
    ],
  },
];

const sampleProducts = categoryProducts.flatMap(({ category, image, description, products }) =>
  products.map(([name, price], index) => ({
    name,
    description: `${description} ${name} is selected for everyday value, dependable quality, and easy use.`,
    price,
    category,
    stockQuantity: 12 + ((index * 7) % 39),
    image,
  }))
);

const importData = async () => {
  let failure;

  try {
    await connectDB();
    if (mongoose.connection.readyState !== 1) {
      throw new Error('MongoDB is not connected. Configure MONGO_URI before seeding.');
    }

    const result = await Product.bulkWrite(
      sampleProducts.map((product) => ({
        updateOne: {
          filter: { name: product.name, category: product.category },
          update: { $set: product },
          upsert: true,
        },
      }))
    );

    const seededProducts = await Product.aggregate([
      {
        $match: {
          $or: sampleProducts.map(({ name, category }) => ({ name, category })),
        },
      },
      {
        $group: {
          _id: { name: '$name', category: '$category' },
          count: { $sum: 1 },
        },
      },
    ]);
    const duplicateProducts = seededProducts.filter(({ count }) => count !== 1);
    if (seededProducts.length !== sampleProducts.length || duplicateProducts.length > 0) {
      throw new Error(
        `Seed verification failed: expected exactly ${sampleProducts.length} unique sample products, found ${seededProducts.length} with ${duplicateProducts.length} duplicate keys.`
      );
    }

    const categoryCounts = await Promise.all(
      categoryProducts.map(async ({ category }) => ({
        category,
        count: await Product.countDocuments({ category }),
      }))
    );
    const missingCategories = categoryCounts.filter(({ count }) => count < 10);
    if (missingCategories.length > 0) {
      throw new Error(
        `Seed verification failed: ${missingCategories.map(({ category }) => category).join(', ')} have fewer than 10 products.`
      );
    }

    console.log(
      `✅ [Seeder]: Verified ${sampleProducts.length} unique sample products (${result.upsertedCount} inserted, ${result.matchedCount} already present, ${result.modifiedCount} updated).`
    );
    categoryCounts.forEach(({ category, count }) => {
      console.log(`  ${category}: ${count} products`);
    });
  } catch (error) {
    failure = error;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      try {
        await mongoose.disconnect();
      } catch (error) {
        failure ??= error;
      }
    }
  }

  if (failure) throw failure;
};

const checkSeedData = async () => {
  for (const { category } of categoryProducts) {
    const products = sampleProducts.filter((product) => product.category === category);
    if (products.length !== 10) {
      throw new Error(`${category} has ${products.length} seed products; expected exactly 10.`);
    }
    await Promise.all(products.map((product) => new Product(product).validate()));
  }

  if (categoryProducts.length !== 10 || sampleProducts.length !== 100) {
    throw new Error(
      `Seed data has ${categoryProducts.length} categories and ${sampleProducts.length} products; expected 10 categories and 100 products.`
    );
  }

  console.log(`✅ [Seeder Check]: ${categoryProducts.length} categories and ${sampleProducts.length} valid products.`);
};

const main = async () => {
  if (process.argv[2] === '--check') {
    await checkSeedData();
    return;
  }

  if (process.argv[2] === '-d') {
    throw new Error('Destructive seeding is disabled. Run npm run seed to upsert sample products.');
  }

  await importData();
};

main().catch((error) => {
  console.error(`❌ [Seeder Error]: ${error.message}`);
  process.exitCode = 1;
});

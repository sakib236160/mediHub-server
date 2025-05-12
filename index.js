require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");

const port = process.env.PORT || 9000;
const app = express();
// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.k7k1l.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("mediHub");
    const usersCollection = db.collection("users");
    const campsCollection = db.collection("camps");
    const ordersCollection = db.collection("orders");
    // save or update a user in db
    app.post("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = req.body;
      // check if user exists in db
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: 'customer',
        timestamp: Date.now(),
      });
      res.send(result);
    });

    // manage user status and role
    app.patch('/users/:email',verifyToken, async(req,res)=>{
      const email =req.params.email
      const query = {email}
      const user = await usersCollection.findOne(query)
      if(!user || user?.status === 'Requested') return res.status(400).send('You have Alrady Request, wait for some time')

      
      const updateDoc = {
        $set:{
          status: 'Requested',
        },
      }
      const result = await usersCollection.updateOne(query, updateDoc)
      console.log(result);
      res.send(result)
    })

    // get user role
    app.get('/users/role/:email', async(req,res)=>{
      const email = req.params.email
      const result = await usersCollection.findOne({email})
      res.send({role: result?.role})
    })
    // Generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // save a camp data in db
    app.post('/camps', verifyToken, async(req,res)=>{
      const camp = req.body
      const result = await campsCollection.insertOne(camp)
      res.send(result) 
    })

    // get all camps form db
    app.get('/camps', async(req,res)=>{
      const result = await campsCollection.find().limit(15).toArray()
      res.send(result) 
    })

    // get a camp by id
    app.get('/camps/:id', async(req,res)=>{
      const id = req.params.id
      const query = {_id: new ObjectId(id)}
      const result = await campsCollection.findOne(query)
      res.send(result);
    })

    // save camp order data db
    app.post('/order', verifyToken, async(req,res)=>{
      const orderInfo = req.body
      console.log(orderInfo);
      const result = await ordersCollection.insertOne(orderInfo)
      res.send(result) 
    })

    //manage camp Participant
    app.patch('/camps/participant/:id', verifyToken, async(req,res)=>{
      const id =req.params.id
      const {participantToUpdate, status} = req.body
      const filter = {_id: new ObjectId(id)}
      let updateDoc = {
        $inc:{participant: -participantToUpdate},
      }
      if(status === 'increase'){
        updateDoc = {
        $inc:{participant: participantToUpdate},
      }
      }
      const result = await campsCollection.updateOne(filter,updateDoc)
      res.send(result);
    })


    // get all orders for a specific customer
    app.get('/customer-orders/:email',verifyToken, async(req,res)=>{
      const email = req.params.email
      const query = {'customer.email':email}
      const result = await ordersCollection.aggregate([
        {
          $match: query,
        },
        {
          $addFields:{
            campId:{$toObjectId: '$campId'},
          },
        },
        {
          $lookup:{
            from: 'camps',
            localField: 'campId',
            foreignField: '_id',
            as: 'camps',
          },
        },
        {
          $unwind: '$camps'
        },
        {
          $addFields: {
            name: '$camps.name',
            image: '$camps.image',
            participant: '$camps.participant',
          }
        },
        {
          $project: {
            camps: 0,
          }
        },
      ]).toArray()
      res.send(result);
    } )

    // Cancle delete and camp
    app.delete('/orders/:id',verifyToken, async(req,res)=>{
      const id = req.params.id
      const query = {_id: new ObjectId(id)}
      const order = await ordersCollection.findOne(query)
      if(order.status === 'Delivered') return res.status(409).send('Cannot cancle once the camp is delivered!')
      const result = await ordersCollection.deleteOne(query)
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from mediHub Server..");
});

app.listen(port, () => {
  console.log(`mediHub is running on port ${port}`);
});
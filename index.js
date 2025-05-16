require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const nodemailer = require("nodemailer");
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);

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

// send email using nodemailer
const sendEmail = (emailAddress, emailData) => {
  // create transporter
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.NODEMAILER_USER,
      pass: process.env.NODEMAILER_PASS,
    },
  });
  // verify connection
  transporter.verify((error, success) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Transporter is ready to emails.", success);
    }
  });
  // transporter.sendMail()
  const mailBody = {
    from: process.env.NODEMAILER_USER,
    to: emailAddress,
    subject: emailData?.subject,
    html: `<p>${emailData?.message}</p>`,
  };
  // send email
  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      // console.log(info)
      console.log("Email Sent: " + info?.response);
    }
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

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      // console.log('data for verifyAdmin middleware----->', req.user?.email)
      const email = req.user?.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "admin")
        return res
          .status(403)
          .send({ message: "ForbiddenAccess! Admin Only Action!" });
      next();
    };
    // verify seller middleware
    const verifySeller = async (req, res, next) => {
      // console.log('data for verifySeller middleware----->', req.user?.email)
      const email = req.user?.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "seller")
        return res
          .status(403)
          .send({ message: "ForbiddenAccess! Seller Only Action!" });
      next();
    };

    // save or update a user in db
    app.post("/users/:email", async (req, res) => {
      sendEmail();
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
        role: "customer",
        timestamp: Date.now(),
      });
      res.send(result);
    });







    app.put('/camps/:id', async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body;

  const result = await campsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updatedData }
  );

  res.send(result);
});








    // manage user status and role
    app.patch("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.status === "Requested")
        return res
          .status(400)
          .send("You have Alrady Request, wait for some time");

      const updateDoc = {
        $set: {
          status: "Requested",
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      console.log(result);
      res.send(result);
    });

    // get all user data
    app.get("/all-users/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: { $ne: email } };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // get user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    // get inventory data for seller
    app.get("/camps/seller", verifyToken, verifySeller, async (req, res) => {
      const email = req.user.email;
      const result = await campsCollection
        .find({ "seller.email": email })
        .toArray();
      res.send(result);
    });

    // delete a camp from db by seller
    app.delete("/camps/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await campsCollection.deleteOne(query);
      res.send(result);
    });

    // updata user role & status
    app.patch(
      "/user/role/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const { role } = req.body;
        const filter = { email };
        const updateDoc = {
          $set: { role, status: "Verified" },
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

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
    app.post("/camps", verifyToken, verifySeller, async (req, res) => {
      const camp = req.body;
      const result = await campsCollection.insertOne(camp);
      res.send(result);
    });

    // get all camps form db
    app.get("/camps", async (req, res) => {
      const result = await campsCollection.find().toArray();
      res.send(result);
    });

    // get a camp by id
    app.get("/camps/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await campsCollection.findOne(query);
      res.send(result);
    });

    // save camp order data db
    app.post("/order", verifyToken, async (req, res) => {
      const orderInfo = req.body;
      console.log(orderInfo);
      const result = await ordersCollection.insertOne(orderInfo);
      // send email
      if (result?.insertedId) {
        // To Customer
        sendEmail(orderInfo?.customer?.email, {
          subject: "Camp Successfully!",
          message: `You've placed an Camp Successfully!. Transaction Id:${result?.insertedId}`,
        });
        // To Seller
        sendEmail(orderInfo?.seller, {
          subject: "Hurray!, You Have an Camp To Process",
          message: `Get The Camps readt for ${orderInfo?.customer?.name}`,
        });
      }
      res.send(result);
    });

    //manage camp Participant
    app.patch("/camps/participant/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { participantToUpdate, status } = req.body;
      const filter = { _id: new ObjectId(id) };
      let updateDoc = {
        $inc: { participant: -participantToUpdate },
      };
      if (status === "increase") {
        updateDoc = {
          $inc: { participant: participantToUpdate },
        };
      }
      const result = await campsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    // get all orders for a specific customer
    app.get("/customer-orders/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "customer.email": email };
      const result = await ordersCollection
        .aggregate([
          {
            $match: query,
          },
          {
            $addFields: {
              campId: { $toObjectId: "$campId" },
            },
          },
          {
            $lookup: {
              from: "camps",
              localField: "campId",
              foreignField: "_id",
              as: "camps",
            },
          },
          {
            $unwind: "$camps",
          },
          {
            $addFields: {
              name: "$camps.name",
              image: "$camps.image",
              participant: "$camps.participant",
            },
          },
          {
            $project: {
              camps: 0,
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    // get all orders for a specific seller
    app.get(
      "/seller-orders/:email",
      verifyToken,
      verifySeller,
      async (req, res) => {
        const email = req.params.email;
        const query = { seller: email };
        const result = await ordersCollection
          .aggregate([
            {
              $match: query,
            },
            {
              $addFields: {
                campId: { $toObjectId: "$campId" },
              },
            },
            {
              $lookup: {
                from: "camps",
                localField: "campId",
                foreignField: "_id",
                as: "camps",
              },
            },
            {
              $unwind: "$camps",
            },
            {
              $addFields: {
                name: "$camps.name",
                participant: "$camps.participant",
              },
            },
            {
              $project: {
                camps: 0,
              },
            },
          ])
          .toArray();
        res.send(result);
      }
    );

    // updata a order  status
    app.patch("/orders/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status },
      };
      const result = await ordersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Cancle delete and camp
    app.delete("/orders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await ordersCollection.findOne(query);
      if (order.status === "Delivered")
        return res
          .status(409)
          .send("Cannot cancle once the camp is delivered!");
      const result = await ordersCollection.deleteOne(query);
      res.send(result);
    });

    // admin stat
    app.get("/admin-stat", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const totalUser = await usersCollection.estimatedDocumentCount();
        const totalCamps = await campsCollection.estimatedDocumentCount();

        const allOrder = await ordersCollection.find().toArray();
        const totalFees = allOrder.reduce(
          (sum, order) => sum + (order.fees || 0),
          0
        );

        const chartData = await ordersCollection
          .aggregate([
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: { $toDate: "$_id" },
                  },
                },
                camp: { $sum: 1 },
                fees: { $sum: "$fees" },
                totalParticipant: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                date: "$_id",
                camp: 1,
                participant: "$totalParticipant",
                fees: 1,
              },
            },
          ])
          .toArray();
        // Total Participants from all camps
        const allCamps = await campsCollection.find().toArray();
        const totalParticipants = allCamps.reduce(
          (sum, camp) => sum + (camp.participant || 0),
          0
        );

        // Optional: breakdown of participants from orders per camp
        const participantDetails = await ordersCollection
          .aggregate([
            {
              $group: {
                _id: "$campId",
                totalJoined: { $sum: 1 },
              },
            },
            {
              $lookup: {
                from: "camps",
                localField: "_id",
                foreignField: "_id",
                as: "camp",
              },
            },
            {
              $unwind: "$camp",
            },
            {
              $project: {
                campName: "$camp.name",
                totalJoined: 1,
              },
            },
          ])
          .toArray();

        res.send({
          totalUser,
          totalCamps,
          totalFees,
          totalParticipants,
          participantDetails, // remove if not needed
          chartData,
        });
      } catch (error) {
        console.error("Admin stat error:", error);
        res.status(500).send({ message: "Something went wrong!" });
      }
    });

    // create payment intent
    app.post('/create-payment-intent', verifyToken, async(req,res)=>{
      const {fees,campId} = req.body
      const camp = await campsCollection.findOne({ _id: new ObjectId(campId)})
      if(!camp){
        return res.status(400).send({message: 'camp Not Found'})
      }
      const totalFees =( fees * camp.fees) * 100 //total fees in sent (poysa)

      const {client_secret} = await stripe.paymentIntents.create({
        amount:totalFees,
        currency: 'usd',
        automatic_payment_methods:{
          enabled: true,
        },
      })
      res.send({clientSecret:client_secret})
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

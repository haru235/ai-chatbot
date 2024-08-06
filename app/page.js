"use client";
import { Box, Button, Stack, TextField, CircularProgress } from "@mui/material";
import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
} from "firebase/firestore";

// firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// initialize firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export default function Home() {
  const initialMessage = {
    role: "assistant",
    content: "Ask me anything!",
  };
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([initialMessage]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // listen for authentication state changes
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
      if (user) {
        loadMessages(user.uid);
      } else {
        setMessages([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // automatically scroll to bottom when messages update
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // retrieve and listen to messages from firebase
  const loadMessages = (userId) => {
    const q = query(
      collection(db, "messages"),
      where("userId", "==", userId),
      orderBy("timestamp", "asc")
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const messages = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setMessages([initialMessage, ...messages]);
    });

    return unsubscribe;
  };

  // Google sign-in using firebase authentication
  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in:", error);
    }
  };

  // sign out
  const signOutUser = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // send message logic
  const sendMessage = async () => {
    if (!user || !message.trim()) return;
    setIsLoading(true);

    try {
      const userMessage = {
        userId: user.uid,
        content: message,
        role: "user",
        timestamp: new Date(),
      };
      await addDoc(collection(db, "messages"), userMessage);
      setMessage("");

      // Create a placeholder for the assistant's response
      const assistantMessageRef = await addDoc(collection(db, "messages"), {
        userId: user.uid,
        content: "",
        role: "assistant",
        timestamp: new Date(),
      });

      // Send request to the server
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify([...messages, userMessage]),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let assistantResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantResponse += chunk;

        // Update the assistant's message in Firestore
        await updateDoc(doc(db, "messages", assistantMessageRef.id), {
          content: assistantResponse,
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box
      width="100vw"
      height="100vh"
      display="flex"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Stack
        direction={"column"}
        width="500px"
        height="700px"
        border="1px solid black"
        p={2}
        spacing={3}
      >
        {user ? (
          <>
            <Button variant="outlined" onClick={signOutUser}>
              Sign Out
            </Button>
            <Stack
              direction={"column"}
              spacing={2}
              flexGrow={1}
              overflow="auto"
              maxHeight="100%"
            >
              {messages.map((message) => (
                <Box
                  key={message.id}
                  display={"flex"}
                  justifyContent={
                    message.role === "assistant" ? "flex-start" : "flex-end"
                  }
                >
                  <Box
                    bgcolor={
                      message.role === "assistant"
                        ? "primary.main"
                        : "secondary.main"
                    }
                    color="white"
                    borderRadius={16}
                    padding={3}
                  >
                    {message.content}
                  </Box>
                </Box>
              ))}
              <div ref={messagesEndRef} />
            </Stack>
            <Stack direction={"row"} spacing={2}>
              <TextField
                label="Message"
                fullWidth
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isLoading}
              />
              <Button
                variant="contained"
                onClick={sendMessage}
                disabled={isLoading}
              >
                {isLoading ? <CircularProgress size={24} /> : "Send"}
              </Button>
            </Stack>
          </>
        ) : (
          <Button variant="contained" onClick={signIn}>
            Sign In with Google
          </Button>
        )}
      </Stack>
    </Box>
  );
}

import { useEffect, useState } from "react";

export interface Greeting {
  primary: string;
  secondary: string;
}

/** Live time + period-aware greeting for the Command Center hero (canon §3.3). */
export function useGreeting(): { time: Date; greeting: Greeting } {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = time.getHours();
  let greeting: Greeting;
  if (h >= 5 && h < 12)
    greeting = { primary: "Good morning", secondary: "A fresh start — ready to build something beautiful." };
  else if (h >= 12 && h < 17)
    greeting = { primary: "Good afternoon", secondary: "The day is in full swing — momentum is everything." };
  else if (h >= 17 && h < 22)
    greeting = { primary: "Good evening", secondary: "The night is young — let's get things done." };
  else greeting = { primary: "Working late", secondary: "The quiet hours — when craft happens." };

  return { time, greeting };
}

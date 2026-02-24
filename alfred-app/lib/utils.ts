import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getCookie(name: string) {
  const value = document.cookie
    .split("; ")
    .find(row => row.startsWith(name + "="))
    ?.split("=")[1];

  return value ? decodeURIComponent(value) : undefined;
}


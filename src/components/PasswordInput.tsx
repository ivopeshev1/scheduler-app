"use client";

import { useState } from "react";

/**
 * Password input with a Show / Hide toggle. Drop-in replacement for
 * <input type="password" ...> on every login / signup / reset / change-
 * password form.
 */
export function PasswordInput({
  id,
  name,
  required,
  minLength,
  defaultValue,
  autoComplete,
  placeholder,
  className = "input",
}: {
  id?: string;
  name: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
  autoComplete?: string;
  placeholder?: string;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        required={required}
        minLength={minLength}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={`${className} pr-16`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-600 hover:text-black px-2 py-0.5"
        tabIndex={-1}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

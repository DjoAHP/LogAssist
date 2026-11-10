import "@testing-library/jest-dom"
import { expect } from "vitest"

declare module "vitest" {
  interface Assertion<T> {
    toBeInTheDocument(): T
    toHaveStyle(css: string | Record<string, string>): T
    toHaveClass(className: string): T
    toHaveAttribute(name: string, value?: string): T
    toHaveTextContent(text: string | RegExp): T
  }
}
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ToolApprovalCard } from "./ToolApprovalCard"

afterEach(cleanup)

it("affiche serveur et outil, mais masque les champs sensibles", () => {
  render(
    <ToolApprovalCard
      request={{
        id: "c1",
        serverId: "db",
        serverName: "Database",
        toolName: "delete",
        arguments: { id: 7, token: "secret", nested: { password: "hidden" } },
      }}
      onAllow={vi.fn()}
      onDeny={vi.fn()}
    />
  )
  expect(screen.getByText("Database — delete")).toBeTruthy()
  expect(screen.getByText(/\[masqué\]/)).toBeTruthy()
  expect(screen.queryByText(/secret|hidden/)).toBeNull()
})

it("délègue Autoriser une fois et Refuser", () => {
  const onAllow = vi.fn()
  const onDeny = vi.fn()
  render(
    <ToolApprovalCard
      request={{ id: "c1", serverId: "db", serverName: "Database", toolName: "delete", arguments: {} }}
      onAllow={onAllow}
      onDeny={onDeny}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Autoriser une fois" }))
  fireEvent.click(screen.getByRole("button", { name: "Refuser" }))
  expect(onAllow).toHaveBeenCalled()
  expect(onDeny).toHaveBeenCalled()
})
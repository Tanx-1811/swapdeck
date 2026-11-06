import Foundation
import Testing
@testable import SwapdeckCore

/// A clock the tests move by hand.
private final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_800_000_000)
    var now: Date { lock.withLock { current } }
    func advance(_ seconds: TimeInterval) { lock.withLock { current = current.addingTimeInterval(seconds) } }
}

@Suite("Terminal tickets")
struct TicketTests {
    let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("swapdeck-tickets-\(UUID().uuidString)")
        .appendingPathComponent("tickets", isDirectory: true)
    private let clock = TestClock()

    private var tickets: TerminalTickets {
        let clock = clock
        return TerminalTickets(directory: folder, now: { clock.now })
    }

    private func cleanUp() {
        try? FileManager.default.removeItem(at: folder.deletingLastPathComponent())
    }

    @Test func aTicketWorksOnceForItsWorkspace() throws {
        defer { cleanUp() }
        let ticket = try tickets.issue(workspaceId: "ws_acme")
        #expect(TerminalTickets.isWellFormed(ticket))
        #expect(tickets.redeem(ticket, workspaceId: "ws_acme"))
        #expect(!tickets.redeem(ticket, workspaceId: "ws_acme"))
        // Every ticket is different.
        #expect(try tickets.issue(workspaceId: "ws_acme") != ticket)
    }

    @Test func aTicketIsUsedUpEvenForTheWrongWorkspace() throws {
        defer { cleanUp() }
        let ticket = try tickets.issue(workspaceId: "ws_acme")
        #expect(!tickets.redeem(ticket, workspaceId: "ws_globex"))
        #expect(!tickets.redeem(ticket, workspaceId: "ws_acme"))
    }

    @Test func aTicketExpiresAfterAMinute() throws {
        defer { cleanUp() }
        let fresh = try tickets.issue(workspaceId: "ws_acme")
        clock.advance(59)
        #expect(tickets.redeem(fresh, workspaceId: "ws_acme"))
        let late = try tickets.issue(workspaceId: "ws_acme")
        clock.advance(61)
        #expect(!tickets.redeem(late, workspaceId: "ws_acme"))
    }

    @Test func refusesMadeUpTickets() throws {
        defer { cleanUp() }
        _ = try tickets.issue(workspaceId: "ws_acme")
        for ticket in ["", "../../etc/passwd", String(repeating: "g", count: 64), String(repeating: "A", count: 64),
                       String(repeating: "a", count: 63), String(repeating: "a", count: 64)] {
            #expect(!tickets.redeem(ticket, workspaceId: "ws_acme"), "\(ticket)")
        }
    }

    @Test func keepsTicketsPrivateAndNamedByTheirHash() throws {
        defer { cleanUp() }
        let ticket = try tickets.issue(workspaceId: "ws_acme")
        let folderMode = try FileManager.default.attributesOfItem(atPath: folder.path)[.posixPermissions] as? NSNumber
        #expect(folderMode?.intValue == 0o700)
        let names = try FileManager.default.contentsOfDirectory(atPath: folder.path)
        #expect(names.count == 1 && !names.contains(ticket))
        let fileMode = try FileManager.default.attributesOfItem(atPath: folder.appendingPathComponent(names[0]).path)[.posixPermissions] as? NSNumber
        #expect(fileMode?.intValue == 0o600)
        let content = try String(contentsOf: folder.appendingPathComponent(names[0]), encoding: .utf8)
        #expect(!content.contains(ticket))
    }

    @Test func purgesTicketsThatCanNoLongerBeUsed() throws {
        defer { cleanUp() }
        _ = try tickets.issue(workspaceId: "ws_old")
        clock.advance(120)
        let current = try tickets.issue(workspaceId: "ws_new")
        try Data("junk".utf8).write(to: folder.appendingPathComponent("junk"))
        #expect(tickets.purgeExpired() == 2)
        #expect(try FileManager.default.contentsOfDirectory(atPath: folder.path).count == 1)
        #expect(tickets.redeem(current, workspaceId: "ws_new"))
        // No folder yet: nothing to do.
        #expect(TerminalTickets(directory: folder.appendingPathComponent("none")).purgeExpired() == 0)
    }
}

export default function Loading() {
  return (
    <div
      className="flex min-h-[70vh] items-center justify-center"
      style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <span
          className="marks-spin"
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 9999,
            border: "2px solid #313640",
            borderTopColor: "#fb923c",
            display: "block",
          }}
        />
        <p
          className="text-sm text-muted-foreground"
          style={{ margin: 0, fontSize: 14, color: "#b4b4be" }}
        >
          Loading
        </p>
      </div>
    </div>
  );
}

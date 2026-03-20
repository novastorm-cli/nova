export function Header() {
  return (
    <header className="bg-blue-600 text-white p-4 flex items-center justify-between">
      <h1>My App</h1>
      <nav className="flex gap-4">
        <a href="/login" className="hover:underline">Login</a>
        <a href="/register" className="hover:underline">Register</a>
      </nav>
    </header>
  );
}

import { useRef, useEffect, useCallback } from "react";

interface SearchBarProps {
  onSearch: (value: string) => void;
}

function SearchBar({ onSearch }: SearchBarProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        onSearch(value);
      }, 300);
    },
    [onSearch],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <input
      className="sessions-search-input"
      type="text"
      autoFocus
      placeholder="Search sessions..."
      onChange={handleChange}
    />
  );
}

export default SearchBar;

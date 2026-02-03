import { useState, useEffect } from 'react';
import { useMatters } from './hooks/useMatters';
import { MatterTable } from './components/MatterTable';
import { Pagination } from './components/Pagination';
import { SearchBar } from './components/SearchBar';

function App() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchInput, setSearchInput] = useState('');  // Immediate input value
  const [search, setSearch] = useState('');             // Debounced value sent to API

  // Debounce search input (500ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1); // Reset to first page when search changes
    }, 500);

    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, total, totalPages, loading, error } = useMatters({
    page,
    limit,
    sortBy,
    sortOrder,
    search,
  });

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1); // Reset to first page on limit change
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-full mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Matter Management System</h1>
            <p className="mt-2 text-sm text-gray-600">
              View and manage all legal matters with cycle time tracking and SLA monitoring
            </p>
          </div>

          <div className="mb-4">
            <SearchBar
              value={searchInput}
              onChange={setSearchInput}
              isLoading={loading}
              placeholder="Search matters by case number, subject, status, assignee, or any field..."
            />
          </div>

          {search && !loading && (
            <div className="mb-4 text-sm text-gray-600">
              {total > 0 ? (
                <span>Found <strong>{total}</strong> matter{total !== 1 ? 's' : ''} matching "{search}"</span>
              ) : (
                <span>No matters found matching "{search}"</span>
              )}
            </div>
          )}

          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            {loading && (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border-l-4 border-red-400 p-4 my-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-5 w-5 text-red-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-red-700">Error: {error}</p>
                  </div>
                </div>
              </div>
            )}

            {!loading && !error && (
              <>
                <MatterTable
                  matters={data}
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  limit={limit}
                  onLimitChange={handleLimitChange}
                  total={total}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;


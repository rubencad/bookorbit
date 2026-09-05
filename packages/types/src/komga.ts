export interface KomgaUser {
  id: number;
  userId: number;
  username: string;
  groupUnknownSeries: boolean;
  includeNonComicBooks: boolean;
  createdAt: string;
}

export interface CreateKomgaUserRequest {
  username: string;
  password: string;
  groupUnknownSeries?: boolean;
  includeNonComicBooks?: boolean;
}

export interface UpdateKomgaUserRequest {
  groupUnknownSeries?: boolean;
  includeNonComicBooks?: boolean;
}

export interface KomgaApiStatus {
  enabled: boolean;
}

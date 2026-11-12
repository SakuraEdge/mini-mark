using System.Text.Json;

namespace Moye;

public sealed record CloudCredential(string AccessToken, string? RefreshToken = null, DateTimeOffset? AccessExpiresAt = null,
    DateTimeOffset? RefreshExpiresAt = null, string? ClientId = null, string? Account = null) {
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public int SchemaVersion { get; init; } = 1;
    public override string ToString() => "GitHub credentials";
    public string Serialize() => JsonSerializer.Serialize(this, JsonOptions);
    public static CloudCredential? Read(string? stored) {
        if (string.IsNullOrWhiteSpace(stored)) return null;
        if (!stored.TrimStart().StartsWith('{')) return new(ValidateToken(stored));
        try {
            var credential = JsonSerializer.Deserialize<CloudCredential>(stored, JsonOptions);
            if (credential is null || credential.SchemaVersion != 1) throw new IOException("GitHub 登录凭据格式无效，请重新登录。");
            ValidateToken(credential.AccessToken);
            if (credential.RefreshToken is not null) ValidateToken(credential.RefreshToken);
            return credential;
        } catch (JsonException) { throw new IOException("GitHub 登录凭据格式无效，请重新登录。"); }
    }
    public static CloudCredential FromResponse(JsonElement response, string clientId, DateTimeOffset now, bool requireRefresh = false) {
        if (response.TryGetProperty("token_type", out var type) &&
            (type.ValueKind != JsonValueKind.String || !string.Equals(type.GetString(), "bearer", StringComparison.OrdinalIgnoreCase)))
            throw new IOException("GitHub 返回的令牌类型无效。");
        var access = response.TryGetProperty("access_token", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        var refresh = response.TryGetProperty("refresh_token", out value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        ValidateToken(access);
        if (refresh is not null) ValidateToken(refresh);
        if (requireRefresh && refresh is null) throw new IOException("GitHub 未返回完整的刷新凭据，请重新登录。");
        var accessExpiry = Expiry(response, "expires_in", now);
        var refreshExpiry = Expiry(response, "refresh_token_expires_in", now);
        if (refresh is not null && (accessExpiry is null || refreshExpiry is null)) throw new IOException("GitHub 登录有效期信息无效。");
        return new(access!, refresh, accessExpiry, refreshExpiry, clientId);
    }
    private static string ValidateToken(string? token) {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 1024 || token.Any(char.IsWhiteSpace) || token.Any(char.IsControl))
            throw new IOException("GitHub 登录凭据无效，请重新登录。");
        return token;
    }
    private static DateTimeOffset? Expiry(JsonElement response, string name, DateTimeOffset now) {
        if (!response.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var seconds) || seconds <= 0 || seconds > (DateTimeOffset.MaxValue - now).TotalSeconds)
            throw new IOException("GitHub 登录有效期信息无效。");
        return now.AddSeconds(seconds);
    }
}

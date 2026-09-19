using System.Security.Cryptography;
using System.Text;

namespace Veno.Web.Authentication;

public sealed class ConfigurationUserAuthenticator(
    IConfiguration configuration,
    ILogger<ConfigurationUserAuthenticator> logger) : IUserAuthenticator
{
    public bool Validate(string email, string password)
    {
        var configuredEmail = configuration["Authentication:Email"];
        var configuredPassword = configuration["Authentication:Password"];

        if (string.IsNullOrWhiteSpace(configuredEmail) || string.IsNullOrEmpty(configuredPassword))
        {
            logger.LogWarning("O login administrativo ainda não foi configurado.");
            return false;
        }

        return FixedTimeEquals(email.Trim().ToLowerInvariant(), configuredEmail.Trim().ToLowerInvariant())
            && FixedTimeEquals(password, configuredPassword);
    }

    private static bool FixedTimeEquals(string supplied, string expected)
    {
        var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(supplied));
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        return CryptographicOperations.FixedTimeEquals(suppliedHash, expectedHash);
    }
}

using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Moye;

public sealed class SingleInstance : IDisposable {
    private readonly Mutex mutex;
    private readonly string pipeName;
    private readonly CancellationTokenSource cancellation = new();
    public bool IsPrimary { get; }

    public SingleInstance(string dataDirectory) {
        pipeName = "Moye-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(dataDirectory.ToUpperInvariant())))[..24];
        mutex = new Mutex(true, @"Local\" + pipeName, out var created);
        IsPrimary = created;
    }

    public void Forward(string[] args) {
        using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.Out);
        pipe.Connect(5000);
        using var writer = new StreamWriter(pipe, new UTF8Encoding(false));
        writer.WriteLine(JsonSerializer.Serialize(args));
    }

    public void Listen(Action<string[]> received) {
        _ = Task.Run(async () => {
            while (!cancellation.IsCancellationRequested) {
                try {
                    using var pipe = new NamedPipeServerStream(pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await pipe.WaitForConnectionAsync(cancellation.Token);
                    using var reader = new StreamReader(pipe, Encoding.UTF8);
                    var input = await reader.ReadLineAsync(cancellation.Token);
                    if (input is not null && input.Length <= 32768) received(JsonSerializer.Deserialize<string[]>(input) ?? []);
                } catch (OperationCanceledException) { break; }
                catch (IOException) { }
                catch (JsonException) { }
            }
        });
    }

    public void Dispose() {
        cancellation.Cancel();
        if (IsPrimary) mutex.ReleaseMutex();
        mutex.Dispose();
    }
}

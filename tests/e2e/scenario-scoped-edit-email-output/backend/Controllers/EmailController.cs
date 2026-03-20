using Microsoft.AspNetCore.Mvc;

namespace WebApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class EmailController : ControllerBase
{
    [HttpPost("send")]
    public IActionResult SendEmail([FromBody] EmailRequest request)
    {
        // In production, use SmtpClient or a service like SendGrid
        if (string.IsNullOrEmpty(request.To) || string.IsNullOrEmpty(request.Subject))
        {
            return BadRequest(new { error = "To and Subject are required" });
        }

        return Ok(new { success = true, message = "Email queued for delivery" });
    }
}
